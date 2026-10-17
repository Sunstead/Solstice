//! The Mac's side of exporting: WebKit's own pagination into a PDF file, and
//! the system share picker. Runs on the main thread (`with_webview`).

use std::cell::RefCell;
use std::ffi::c_void;
use std::path::Path;
use std::sync::Mutex;

use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject};
use objc2::{define_class, msg_send, sel, AllocAnyThread, MainThreadMarker, MainThreadOnly, DefinedClass};
use objc2_app_kit::{
    NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob, NSPrintingPaginationMode,
    NSSharingServicePicker, NSWindow,
};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSRectEdge, NSSize, NSString, NSURL};
use objc2_web_kit::WKWebView;
use tokio::sync::oneshot;

use super::{Anchor, PageSpec};

type Done = oneshot::Sender<Result<(), String>>;

define_class!(
    // Told when a print operation finishes (`didRunSelector`).
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "SolsticeExportPrintDelegate"]
    #[ivars = Mutex<Option<Done>>]
    struct PrintDelegate;

    impl PrintDelegate {
        #[unsafe(method(printOperationDidRun:success:contextInfo:))]
        fn did_run(&self, _operation: &NSPrintOperation, success: Bool, _context: *mut c_void) {
            if let Some(done) = self.ivars().lock().unwrap().take() {
                let _ = done.send(if success.as_bool() { Ok(()) } else { Err("The PDF couldn't be written.".into()) });
            }
        }
    }
);

thread_local! {
    // Kept alive until the next print: AppKit doesn't retain a modal delegate.
    static DELEGATE: RefCell<Option<Retained<PrintDelegate>>> = const { RefCell::new(None) };
    // The picker stays up after `show` returns.
    static PICKER: RefCell<Option<Retained<NSSharingServicePicker>>> = const { RefCell::new(None) };
}

/// Prints the page in `webview` (a `WKWebView`, in `window`) to `out`,
/// paginated by WebKit, with no panels; `done` hears how it went.
pub fn print_to_pdf(webview: *mut c_void, window: *mut c_void, page: PageSpec, out: &Path, done: Done) {
    let Some(mtm) = MainThreadMarker::new() else {
        let _ = done.send(Err("Printing has to start on the main thread.".into()));
        return;
    };
    // SAFETY: Tauri hands over its own live WKWebView and NSWindow.
    let (webview, window) = unsafe { (&*(webview as *const WKWebView), &*(window as *const NSWindow)) };

    let info = NSPrintInfo::new();
    let url = NSURL::fileURLWithPath(&NSString::from_str(&out.to_string_lossy()));
    // SAFETY: the dictionary takes these keys and values (NSPrintInfo.h).
    unsafe {
        let dictionary = info.dictionary();
        dictionary.setObject_forKey(&url, ProtocolObjectKey::of(NSPrintJobSavingURL));
        info.setJobDisposition(NSPrintSaveJob);
    }
    info.setPaperSize(NSSize::new(page.width, page.height));
    for set in [NSPrintInfo::setTopMargin, NSPrintInfo::setBottomMargin, NSPrintInfo::setLeftMargin, NSPrintInfo::setRightMargin] {
        set(&info, page.margin);
    }
    info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
    info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
    info.setHorizontallyCentered(false);
    info.setVerticallyCentered(false);

    // SAFETY: a live web view, and print info set up above.
    let operation = unsafe { webview.printOperationWithPrintInfo(&info) };
    operation.setShowsPrintPanel(false);
    operation.setShowsProgressPanel(false);
    // WebKit prints blank pages unless its print view has a size.
    if let Some(view) = operation.view() {
        view.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(page.width, page.height)));
    }

    let delegate = PrintDelegate::alloc(mtm).set_ivars(Mutex::new(Some(done)));
    // SAFETY: NSObject's init on our own subclass.
    let delegate: Retained<PrintDelegate> = unsafe { msg_send![super(delegate), init] };
    // SAFETY: the delegate answers the selector with the signature AppKit
    // calls it with, and lives (in DELEGATE) until after it's called.
    unsafe {
        operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            window,
            Some(&delegate),
            Some(sel!(printOperationDidRun:success:contextInfo:)),
            std::ptr::null_mut(),
        );
    }
    DELEGATE.with(|kept| *kept.borrow_mut() = Some(delegate));
}

/// The share picker for `paths`, from `anchor` (or the web view's top
/// middle) in the web view, which is flipped like the page.
pub fn share(webview: *mut c_void, paths: &[String], anchor: Option<Anchor>) {
    // SAFETY: Tauri hands over its own live WKWebView.
    let webview = unsafe { &*(webview as *const WKWebView) };
    let urls: Vec<Retained<NSURL>> = paths.iter().map(|p| NSURL::fileURLWithPath(&NSString::from_str(p))).collect();
    let items: Retained<NSArray<NSURL>> = NSArray::from_retained_slice(&urls);
    // SAFETY: an array of NSURLs is an array of objects, and file URLs are
    // items the picker shares (NSPasteboardWriting).
    let picker = unsafe {
        let items: Retained<NSArray> = Retained::cast_unchecked(items);
        NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &items)
    };
    let bounds = webview.bounds();
    let rect = match anchor {
        Some(a) => NSRect::new(NSPoint::new(a.x, a.y), NSSize::new(a.width.max(1.0), a.height.max(1.0))),
        None => NSRect::new(NSPoint::new(bounds.size.width / 2.0, 0.0), NSSize::new(1.0, 1.0)),
    };
    picker.showRelativeToRect_ofView_preferredEdge(rect, webview, NSRectEdge::MaxY);
    PICKER.with(|kept| *kept.borrow_mut() = Some(picker));
}

/// `NSPrintJobSavingURL` as the dictionary's key type.
struct ProtocolObjectKey;

impl ProtocolObjectKey {
    fn of(key: &'static NSString) -> &'static objc2::runtime::ProtocolObject<dyn objc2_foundation::NSCopying> {
        objc2::runtime::ProtocolObject::from_ref(key)
    }
}
