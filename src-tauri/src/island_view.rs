//! Small AppKit building blocks for the notch surface. No notification policy lives here.
use crate::island_style::{initials, Appearance, Mode, GLOW};
use objc2::rc::Retained;
use objc2::{define_class, msg_send, sel, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::*;
use objc2_foundation::{NSData, NSNumber, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
use objc2_quartz_core::{CAMediaTiming, CASpringAnimation};
use std::cell::{Cell, OnceCell, RefCell};

pub fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
}
pub fn color(rgb: [f64; 3], alpha: f64) -> Retained<NSColor> {
    NSColor::colorWithSRGBRed_green_blue_alpha(rgb[0], rgb[1], rgb[2], alpha)
}

/// The island: one black shape hanging from the screen's top edge, like the notch grown
/// downward. Concave fillets where it meets the top edge (as the hardware notch has),
/// straight sides, rounded bottom corners. `g` = the glow margin left/right/below.
/// Returns the closed fill and the open rim (sides + bottom, no top edge) for the light.
fn island_shape(bw: f64, bh: f64, g: f64, radius: f64) -> (Retained<NSBezierPath>, Retained<NSBezierPath>) {
    let (l, r, h) = (g, bw - g, bh - g);
    let ear = 7.0f64.min(g);
    let radius = radius.min((r - l) / 2.0).min(h / 2.0).max(0.0);
    let fill = NSBezierPath::bezierPath();
    fill.moveToPoint(NSPoint::new(l - ear, 0.0));
    fill.appendBezierPathWithArcFromPoint_toPoint_radius(NSPoint::new(l, 0.0), NSPoint::new(l, h), ear);
    fill.appendBezierPathWithArcFromPoint_toPoint_radius(NSPoint::new(l, h), NSPoint::new(r, h), radius);
    fill.appendBezierPathWithArcFromPoint_toPoint_radius(NSPoint::new(r, h), NSPoint::new(r, 0.0), radius);
    fill.appendBezierPathWithArcFromPoint_toPoint_radius(NSPoint::new(r, 0.0), NSPoint::new(r + ear, 0.0), ear);
    fill.lineToPoint(NSPoint::new(r + ear, 0.0));
    fill.closePath();
    let rim = NSBezierPath::bezierPath();
    rim.moveToPoint(NSPoint::new(l, ear));
    rim.appendBezierPathWithArcFromPoint_toPoint_radius(NSPoint::new(l, h), NSPoint::new(r, h), radius);
    rim.appendBezierPathWithArcFromPoint_toPoint_radius(NSPoint::new(r, h), NSPoint::new(r, 0.0), radius);
    rim.lineToPoint(NSPoint::new(r, ear));
    (fill, rim)
}
/// Light, not a line: the accent spreads outward from the shape (a wide soft halo plus a
/// tighter brighter one), and bleeds a little inward from the rim so the edge itself glows.
/// `bg`: black like the notch (compact, peek) or the theme's background (expanded); a theme
/// body fades up to black behind the hardware notch (`neck` tall) so the join never shows.
fn lit(fill: &NSBezierPath, rim: &NSBezierPath, rgb: [f64; 3], strength: f64, bg: [f64; 3], neck: f64, width: f64) {
    let body = color(bg, 1.0);
    for (blur, alpha) in [(22.0, 0.75 * strength), (7.0, 0.6 * strength)] {
        NSGraphicsContext::saveGraphicsState_class();
        let shadow = NSShadow::new();
        shadow.setShadowColor(Some(&color(rgb, alpha)));
        shadow.setShadowBlurRadius(blur);
        shadow.setShadowOffset(NSSize::new(0.0, 0.0));
        shadow.set();
        body.setFill();
        fill.fill();
        NSGraphicsContext::restoreGraphicsState_class();
    }
    body.setFill();
    fill.fill();
    if neck > 0.0 && bg != [0.0, 0.0, 0.0] {
        if let Some(fade) = NSGradient::initWithStartingColor_endingColor(NSGradient::alloc(), &NSColor::blackColor(), &body) {
            NSGraphicsContext::saveGraphicsState_class();
            fill.addClip();
            NSColor::blackColor().setFill();
            NSBezierPath::fillRect(rect(0.0, 0.0, width, neck * 0.6));
            fade.drawFromPoint_toPoint_options(NSPoint::new(0.0, neck * 0.6), NSPoint::new(0.0, neck), NSGradientDrawingOptions::empty());
            NSGraphicsContext::restoreGraphicsState_class();
        }
    }
    // inner bleed: a blurred rim, clipped to the inside of the shape
    NSGraphicsContext::saveGraphicsState_class();
    fill.addClip();
    let shadow = NSShadow::new();
    shadow.setShadowColor(Some(&color(rgb, 0.45 * strength)));
    shadow.setShadowBlurRadius(9.0);
    shadow.setShadowOffset(NSSize::new(0.0, 0.0));
    shadow.set();
    color(rgb, 0.22 * strength).setStroke();
    rim.setLineWidth(1.0);
    rim.stroke();
    NSGraphicsContext::restoreGraphicsState_class();
}
pub fn rule(mtm: MainThreadMarker, parent: &NSView, frame: NSRect, p: Appearance) {
    let line = NSBox::initWithFrame(NSBox::alloc(mtm), frame);
    line.setBoxType(NSBoxType::Custom);
    #[allow(deprecated)]
    line.setBorderType(NSBorderType::NoBorder);
    line.setFillColor(&color(p.secondary, if p.light { 0.16 } else { 0.12 }));
    line.setContentViewMargins(NSSize::new(0.0, 0.0));
    parent.addSubview(&line);
}

pub struct SurfaceIvars {
    pub appearance: Cell<Appearance>,
    pub mode: Cell<Mode>,
    pub notch: Cell<f64>,
    pub neck_height: Cell<f64>,
    pub body: bool,
}
define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "ChatMinIslandV2Surface"]
    #[ivars = SurfaceIvars]
    pub struct Surface;
    unsafe impl NSObjectProtocol for Surface {}
    impl Surface {
        #[unsafe(method(isFlipped))]
        fn flipped(&self) -> bool { true }
        #[unsafe(method(drawRect:))]
        fn draw(&self, _dirty: NSRect) {
            let b=self.bounds(); let iv=self.ivars();
            if iv.body { return; }
            let p=iv.appearance.get();
            let (radius,strength)=match iv.mode.get() { Mode::Compact => (13.0,0.8), _ => (26.0,1.0) };
            // the light is always the theme's; the body only takes the theme once expanded
            let bg=if iv.mode.get()==Mode::Expanded {p.background} else {[0.0,0.0,0.0]};
            let (fill,rim)=island_shape(b.size.width,b.size.height,GLOW,radius);
            lit(&fill,&rim,p.accent,strength,bg,iv.neck_height.get(),b.size.width);
        }
        #[unsafe(method(mouseEntered:))]
        fn entered(&self,_event:&NSEvent) { if !self.ivars().body {crate::island::hover(true);} }
        #[unsafe(method(mouseExited:))]
        fn exited(&self,_event:&NSEvent) { if !self.ivars().body {crate::island::hover(false);} }
        // the tracking area includes the glow margin: hover starts once the pointer is on the shape
        #[unsafe(method(mouseMoved:))]
        fn moved(&self,_event:&NSEvent) { if !self.ivars().body {crate::island::pointer_moved();} }
    }
);
impl Surface {
    pub fn new(mtm: MainThreadMarker, frame: NSRect, p: Appearance, mode: Mode, notch: f64, body: bool) -> Retained<Self> {
        let view = Self::alloc(mtm).set_ivars(SurfaceIvars {
            appearance: Cell::new(p),
            mode: Cell::new(mode),
            notch: Cell::new(notch),
            neck_height: Cell::new(0.0),
            body,
        });
        let view: Retained<Self> = unsafe { msg_send![super(view),initWithFrame:frame] };
        view.setWantsLayer(true);
        if let Some(layer) = view.layer() {
            layer.setMasksToBounds(true);
        }
        view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
        view
    }
    pub fn appearance(&self, p: Appearance, mode: Mode, notch: f64, neck_height: f64) {
        self.ivars().appearance.set(p);
        self.ivars().mode.set(mode);
        self.ivars().notch.set(notch);
        self.ivars().neck_height.set(neck_height);
        self.setNeedsDisplay(true);
    }
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "ChatMinIslandV2Content"]
    pub struct Content;
    unsafe impl NSObjectProtocol for Content {}
    impl Content { #[unsafe(method(isFlipped))] fn flipped(&self)->bool{true} }
);
impl Content {
    pub fn new(mtm: MainThreadMarker, frame: NSRect) -> Retained<Self> {
        let view = Self::alloc(mtm).set_ivars(());
        let view: Retained<Self> = unsafe { msg_send![super(view),initWithFrame:frame] };
        view.setWantsLayer(true);
        view
    }
}

pub struct ButtonIvars {
    accent: [f64; 3],
    hovered: Cell<bool>,
    radius: f64,
    pill: bool,
}
define_class!(
    #[unsafe(super(NSButton))]
    #[thread_kind = MainThreadOnly]
    #[name = "ChatMinIslandV2Button"]
    #[ivars = ButtonIvars]
    pub struct Button;
    unsafe impl NSObjectProtocol for Button {}
    impl Button {
        #[unsafe(method(isFlipped))] fn flipped(&self)->bool{true}
        #[unsafe(method(drawRect:))]
        fn draw(&self,dirty:NSRect){
            if self.ivars().pill {
                let path=NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(rect(0.5,0.5,self.bounds().size.width-1.0,self.bounds().size.height-1.0),12.0,12.0);
                color(self.ivars().accent,0.04).setFill();path.fill();color(self.ivars().accent,0.18).setStroke();path.setLineWidth(0.6);path.stroke();
            }
            if self.ivars().hovered.get() || self.isHighlighted(){
                color(self.ivars().accent,if self.isHighlighted(){0.17}else{0.08}).setFill();
                NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(self.bounds(),self.ivars().radius,self.ivars().radius).fill();
            }
            unsafe {let _:()=msg_send![super(self),drawRect:dirty];}
        }
        #[unsafe(method(mouseEntered:))] fn entered(&self,_:&NSEvent){self.ivars().hovered.set(true);NSView::setNeedsDisplay(self,true);}
        #[unsafe(method(mouseExited:))] fn exited(&self,_:&NSEvent){self.ivars().hovered.set(false);NSView::setNeedsDisplay(self,true);}
    }
);
#[allow(clippy::too_many_arguments)]
pub fn button(
    mtm: MainThreadMarker,
    parent: &NSView,
    target: &objc2::runtime::AnyObject,
    title: &str,
    help: &str,
    frame: NSRect,
    tag: isize,
    p: Appearance,
    key: Option<&str>,
) -> Retained<Button> {
    let b = Button::alloc(mtm).set_ivars(ButtonIvars {
        accent: p.accent,
        hovered: Cell::new(false),
        radius: 12.0,
        pill: tag == -2,
    });
    let b: Retained<Button> = unsafe { msg_send![super(b),initWithFrame:frame] };
    b.setTitle(&NSString::from_str(title));
    b.setBordered(false);
    b.setContentTintColor(Some(&color(p.foreground, 1.0)));
    b.setTag(tag);
    b.setRefusesFirstResponder(true);
    b.setFont(Some(&NSFont::systemFontOfSize_weight(11.0, 0.15)));
    b.setAccessibilityLabel(Some(&NSString::from_str(help)));
    if let Some(key) = key {
        b.setIdentifier(Some(&NSString::from_str(key)));
    }
    unsafe {
        b.setTarget(Some(target));
        b.setAction(Some(sel!(activate:)));
    }
    let area = unsafe {
        NSTrackingArea::initWithRect_options_owner_userInfo(
            NSTrackingArea::alloc(),
            b.bounds(),
            NSTrackingAreaOptions::MouseEnteredAndExited | NSTrackingAreaOptions::ActiveAlways | NSTrackingAreaOptions::InVisibleRect,
            Some(&b),
            None,
        )
    };
    b.addTrackingArea(&area);
    parent.addSubview(&b);
    b
}
#[allow(clippy::too_many_arguments)]
pub fn label(
    mtm: MainThreadMarker,
    parent: &NSView,
    text: &str,
    frame: NSRect,
    size: f64,
    weight: f64,
    rgb: [f64; 3],
) -> Retained<NSTextField> {
    let f = NSTextField::labelWithString(&NSString::from_str(text), mtm);
    f.setFrame(frame);
    f.setFont(Some(&NSFont::systemFontOfSize_weight(size, weight)));
    f.setTextColor(Some(&color(rgb, 1.0)));
    f.setLineBreakMode(NSLineBreakMode::ByTruncatingTail);
    f.setMaximumNumberOfLines(if frame.size.height > 26.0 { 2 } else { 1 });
    f.setUsesSingleLineMode(frame.size.height <= 26.0);
    parent.addSubview(&f);
    f
}
pub fn symbol(mtm: MainThreadMarker, parent: &NSView, name: &str, frame: NSRect, rgb: [f64; 3]) {
    let view = NSImageView::initWithFrame(NSImageView::alloc(mtm), frame);
    view.setImage(NSImage::imageWithSystemSymbolName_accessibilityDescription(&NSString::from_str(name), None).as_deref());
    view.setImageScaling(NSImageScaling::ScaleProportionallyUpOrDown);
    view.setContentTintColor(Some(&color(rgb, 1.0)));
    parent.addSubview(&view);
}
pub fn platform(key: &str) -> (&'static str, &'static str) {
    if key.starts_with("tg-") {
        ("Telegram", "paperplane.fill")
    } else if key.starts_with("gc-") {
        ("Google Chat", "bubble.left.and.bubble.right.fill")
    } else {
        ("ChatMin", "bell.badge.fill")
    }
}

fn brand_image(key: &str) -> Option<Retained<NSImage>> {
    let bytes: &[u8] = if key.starts_with("tg-") {
        include_bytes!("../resources/island/telegram.png")
    } else if key.starts_with("gc-") {
        include_bytes!("../resources/island/gchat.png")
    } else if key.starts_with("messenger-") {
        include_bytes!("../resources/island/messenger.png")
    } else if key.starts_with("zalo-") {
        include_bytes!("../resources/island/zalo.png")
    } else {
        include_bytes!("../icons/128x128.png")
    };
    let image = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes))?;
    image.setTemplate(false);
    Some(image)
}
pub struct AvatarIvars {
    accent: [f64; 3],
    image: RefCell<Option<Retained<NSImage>>>,
    text: OnceCell<Retained<NSTextField>>,
}
define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "ChatMinIslandV2Avatar"]
    #[ivars = AvatarIvars]
    pub struct Avatar;
    unsafe impl NSObjectProtocol for Avatar {}
    impl Avatar {
        #[unsafe(method(isFlipped))] fn flipped(&self)->bool{true}
        #[unsafe(method(drawRect:))] fn draw(&self,_:NSRect){
            let b=self.bounds();let bounds=rect(0.5,0.5,b.size.width-1.0,b.size.height-1.0);
            let path=NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(bounds,12.0,12.0);
            color(self.ivars().accent,0.14).setFill();path.fill();
            if let Some(image)=self.ivars().image.borrow().as_ref(){
                NSGraphicsContext::saveGraphicsState_class();path.addClip();
                let size=image.size();let side=size.width.min(size.height);
                let crop=rect((size.width-side)/2.0,(size.height-side)/2.0,side,side);
                unsafe { image.drawInRect_fromRect_operation_fraction_respectFlipped_hints(bounds,crop,NSCompositingOperation::SourceOver,1.0,true,None); }
                NSGraphicsContext::restoreGraphicsState_class();
            }
            color(self.ivars().accent,0.22).setStroke();path.setLineWidth(0.7);path.stroke();
        }
    }
);
impl Avatar {
    fn image(&self, image: Option<Retained<NSImage>>) {
        let has = image.is_some();
        *self.ivars().image.borrow_mut() = image;
        if let Some(text) = self.ivars().text.get() {
            text.setHidden(has);
        }
        self.setNeedsDisplay(true);
    }
    pub fn set_photo(&self, path: &str) {
        if !crate::island_media::local_image(std::path::Path::new(path)) {
            return;
        }
        if let Some(image) = NSImage::initWithContentsOfFile(NSImage::alloc(), &NSString::from_str(path)) {
            let size = image.size();
            if size.width > 0.0 && size.height > 0.0 && image.isValid() {
                self.image(Some(image));
            }
        }
    }
}
pub fn avatar(
    mtm: MainThreadMarker,
    parent: &NSView,
    name: &str,
    key: &str,
    photo: &str,
    frame: NSRect,
    p: Appearance,
    animate: bool,
) -> Retained<Avatar> {
    let a = Avatar::alloc(mtm).set_ivars(AvatarIvars {
        accent: p.accent,
        image: RefCell::new(None),
        text: OnceCell::new(),
    });
    let a: Retained<Avatar> = unsafe { msg_send![super(a),initWithFrame:frame] };
    a.setWantsLayer(true);
    let text = label(
        mtm,
        &a,
        &initials(name),
        rect(0.0, 9.0, frame.size.width, 22.0),
        14.0,
        0.35,
        p.accent,
    );
    text.setAlignment(NSTextAlignment::Center);
    let _ = a.ivars().text.set(text);
    let branded = brand_image(key);
    if key.starts_with("alert:") {
        a.image(branded);
    } else {
        a.set_photo(photo);
        // A separate non-template image view preserves original artwork colors.
        let badge = NSImageView::initWithFrame(
            NSImageView::alloc(mtm),
            rect(frame.size.width - 13.0, frame.size.height - 13.0, 17.0, 17.0),
        );
        badge.setImage(branded.as_deref());
        badge.setImageScaling(NSImageScaling::ScaleProportionallyUpOrDown);
        a.addSubview(&badge);
    }
    parent.addSubview(&a);
    if animate {
        if let Some(layer) = a.layer() {
            let spring = CASpringAnimation::animationWithKeyPath(Some(&NSString::from_str("transform.scale")));
            unsafe {
                spring.setFromValue(Some(&NSNumber::new_f64(0.78)));
                spring.setToValue(Some(&NSNumber::new_f64(1.0)));
            }
            spring.setMass(1.0);
            spring.setStiffness(300.0);
            spring.setDamping(25.0);
            spring.setInitialVelocity(0.0);
            spring.setDuration(0.48);
            layer.addAnimation_forKey(&spring, Some(&NSString::from_str("island-avatar")));
        }
    }
    a
}
