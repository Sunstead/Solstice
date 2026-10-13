import AuthenticationServices
import Tauri
import UIKit

/// The sign-in sheet. The provider redirects to the loopback listener Rust is
/// already waiting on, which works because the sheet keeps the app in the
/// foreground (Safari would suspend it). So no callback comes back through
/// here: Rust closes the sheet once it has the code.
final class AuthenticationSheet: NSObject, ASWebAuthenticationPresentationContextProviding {
  private var session: ASWebAuthenticationSession?
  private var finished = false
  weak var window: UIWindow?

  func start(_ url: URL, window: UIWindow?, done: @escaping (Bool) -> Void) {
    session?.cancel()
    finished = false
    self.window = window
    // Never called back: the redirect is loopback, so this scheme only marks
    // the sheet as ours.
    let session = ASWebAuthenticationSession(url: url, callback: .customScheme("solstice")) {
      [weak self] _, _ in
      guard let self else { return }
      self.session = nil
      done(self.finished)
    }
    session.presentationContextProvider = self
    // Shares Safari's sign-in, so someone already signed in only confirms.
    session.prefersEphemeralWebBrowserSession = false
    self.session = session
    session.start()
  }

  func finish() {
    finished = true
    session?.cancel()
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    window ?? ASPresentationAnchor()
  }
}

extension NativePlugin {
  @objc public func authenticate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UrlArgs.self)
    guard let url = URL(string: args.url) else {
      invoke.reject("Not a URL: \(args.url)")
      return
    }
    DispatchQueue.main.async {
      self.auth.start(url, window: self.manager.viewController?.view.window) { finished in
        if finished {
          invoke.resolve()
        } else {
          invoke.reject("Sign-in was cancelled.")
        }
      }
    }
  }

  @objc public func dismissAuthentication(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.auth.finish()
      invoke.resolve()
    }
  }
}
