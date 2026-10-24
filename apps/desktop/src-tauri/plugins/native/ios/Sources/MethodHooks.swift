import Foundation
import ObjectiveC

/// Changing what UIKit and WebKit do, without changing any object's class.
/// Key-value observing gives an observed object a class of its own, and a
/// class made from that one broke observing it (adding or removing a web
/// view, the share sheet and PDF printing crashed). So methods are replaced
/// on the object's real class instead.

/// `object`'s class as it was made: past the one key-value observing gives
/// an object it observes, which comes and goes with the observers.
func realClass(of object: AnyObject) -> AnyClass {
  var cls: AnyClass = object_getClass(object) ?? type(of: object)
  while NSStringFromClass(cls).hasPrefix("NSKVONotifying_"), let superclass = class_getSuperclass(cls) {
    cls = superclass
  }
  return cls
}

/// Has `cls` run `make(original)` for `selector`, given the implementation it
/// had (its superclass's, when it only inherited one: then it's added to
/// `cls`, so its superclass and every other class are left as they were).
/// `make` returns an `@convention(block)` closure taking the receiver first.
func replaceMethod(of cls: AnyClass, _ selector: Selector, with make: (IMP) -> Any) {
  guard let method = class_getInstanceMethod(cls, selector) else { return }
  let replacement = imp_implementationWithBlock(make(method_getImplementation(method)))
  if !class_addMethod(cls, selector, replacement, method_getTypeEncoding(method)) {
    // `cls` has its own, so `method` is it.
    method_setImplementation(method, replacement)
  }
}
