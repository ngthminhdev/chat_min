//! Native notification island: compact tab → new-message peek → grouped history.
use crate::island_queue::{placement_with_width, IslandQueue};
use crate::island_style::{
    confirmed_hover, hover_expand_needed, layout, reanimate, select_display, split_title, Appearance, Display, Mode, GLOW,
};
use crate::island_view::{self as ui, Content, Surface};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::*;
use objc2_foundation::{
    NSNotification, NSNotificationCenter, NSNumber, NSObject, NSObjectProtocol, NSOperationQueue, NSRect, NSString, NSTimer,
};
use objc2_quartz_core::CAMediaTimingFunction;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    ptr::NonNull,
    rc::Rc,
};
use ui::{color, rect};

type Open = Rc<dyn Fn(&str)>;
thread_local! {
    static ISLAND:RefCell<Option<Island>>=const{RefCell::new(None)};
    static SESSION_ACTIVE:Cell<bool>=const{Cell::new(true)};
    static APPEARANCE:Cell<Appearance>=Cell::new(Appearance::default());
    #[cfg(debug_assertions)]
    static PREVIEW_DISPLAY:Cell<Option<u64>>=const{Cell::new(None)};
}
struct ActionIvars {
    open: Open,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ChatMinIslandV2Actions"]
    #[ivars = ActionIvars]
    struct Actions;
    unsafe impl NSObjectProtocol for Actions {}
    impl Actions{
        #[unsafe(method(activate:))]
        fn activate(&self,sender:&NSButton){
            let target=ISLAND.with(|cell|{
                let Ok(mut state)=cell.try_borrow_mut() else{return None};let island=state.as_mut()?;
                match sender.tag(){
                    -3=>{island.render(self.mtm(),Mode::Expanded,true);None},
                    -1=>{island.dismiss();None},
                    -2=>{island.collapse(self.mtm());Some(String::new())},
                    _=>{
                        // Bind actions to the rendered notice while a burst awaits repaint.
                        let (key,target)=serde_json::from_str::<(String,String)>(&sender.identifier()?.to_string()).ok()?;
                        let dismiss_only=sender.tag()==-4;
                        island.queue.take_matching(&key,&target);
                        island.collapse(self.mtm());
                        if dismiss_only {None} else {Some(target)}
                    }
                }
            });
            if let Some(target)=target{(self.ivars().open)(&target);}
        }
    }
);
struct Island {
    panel: Retained<NSPanel>,
    root: Retained<Surface>,
    tint: Retained<Surface>,
    glass: Retained<NSVisualEffectView>,
    content: Option<Retained<Content>>,
    avatars: RefCell<HashMap<String, Retained<ui::Avatar>>>,
    screen_id: Option<u64>,
    follow_pointer: bool,
    motion_target: Option<NSRect>,
    motion_active: bool,
    visual_mode: Mode,
    actions: Retained<Actions>,
    queue: IslandQueue,
    mode: Mode,
    appearance: Appearance,
    hovered: bool,
    timer: Option<Retained<NSTimer>>,
    pending: Option<Retained<NSTimer>>,
    hover_timer: Option<Retained<NSTimer>>,
    generation: Rc<Cell<u64>>,
    _observers: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
}
fn screen_id(s: &NSScreen) -> u64 {
    s.deviceDescription()
        .objectForKey(&NSString::from_str("NSScreenNumber"))
        .and_then(|v| v.downcast::<NSNumber>().ok())
        .map(|v| v.unsignedLongLongValue())
        .unwrap_or(0)
}
fn screen(mtm: MainThreadMarker, pinned: Option<u64>) -> Option<Retained<NSScreen>> {
    #[cfg(debug_assertions)]
    let pinned = PREVIEW_DISPLAY.with(Cell::get).or(pinned);
    let screens = NSScreen::screens(mtm);
    let displays: Vec<_> = screens
        .iter()
        .map(|s| {
            let f = s.frame();
            Display {
                id: screen_id(&s),
                x: f.origin.x,
                y: f.origin.y,
                width: f.size.width,
                height: f.size.height,
            }
        })
        .collect();
    let mouse = NSEvent::mouseLocation();
    select_display(&displays, (mouse.x, mouse.y), pinned).map(|i| screens.objectAtIndex(i))
}
fn notch_width(s: &NSScreen) -> f64 {
    if s.safeAreaInsets().top <= 0.0 {
        return 172.0;
    }
    let left = s.auxiliaryTopLeftArea();
    let right = s.auxiliaryTopRightArea();
    (right.origin.x - left.origin.x - left.size.width).clamp(156.0, 292.0)
}
fn reduced() -> bool {
    NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
}
/// On the black shape itself: the panel's glow margin (left, right, below) doesn't count.
fn within(frame: NSRect) -> bool {
    let m = NSEvent::mouseLocation();
    m.x >= frame.origin.x + GLOW && m.x <= frame.origin.x + frame.size.width - GLOW && m.y >= frame.origin.y + GLOW && m.y <= frame.origin.y + frame.size.height
}
fn with_island(f: impl FnOnce(&mut Island)) {
    ISLAND.with(|cell| {
        if let Ok(mut state) = cell.try_borrow_mut() {
            if let Some(island) = state.as_mut() {
                f(island);
            }
        }
    });
}
fn timer(seconds: f64, f: impl Fn() + 'static) -> Retained<NSTimer> {
    let block = block2::RcBlock::new(move |_: NonNull<NSTimer>| f());
    unsafe { NSTimer::scheduledTimerWithTimeInterval_repeats_block(seconds, false, &block) }
}
fn stop(slot: &mut Option<Retained<NSTimer>>) {
    if let Some(t) = slot.take() {
        t.invalidate();
    }
}

/// The tracking area covers the glow too, so entering it isn't hovering yet: follow the pointer.
pub(crate) fn pointer_moved() {
    let mut change = None;
    with_island(|i| {
        let inside = within(i.panel.frame());
        if inside != i.hovered {
            change = Some(inside);
        }
    });
    if let Some(inside) = change {
        hover(inside);
    }
}
pub(crate) fn hover(value: bool) {
    with_island(|i| {
        let inside = within(i.panel.frame());
        if value != inside {
            return;
        }
        let change = confirmed_hover(i.hovered, value, inside);
        if change.is_none() && !value {
            return;
        }
        i.hovered = value;
        if value {
            stop(&mut i.timer);
            i.arm_hover();
        } else {
            stop(&mut i.hover_timer);
            if i.mode != Mode::Compact && i.panel.isVisible() {
                i.arm();
            }
        }
    });
}

impl Island {
    fn new(mtm: MainThreadMarker, open: Open) -> Self {
        let p = APPEARANCE.with(Cell::get);
        let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
            NSPanel::alloc(mtm),
            rect(0.0, 0.0, 220.0, 25.0),
            NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
            NSBackingStoreType::Buffered,
            false,
        );
        panel.setTitle(&NSString::from_str("ChatMin · Notification Island"));
        panel.setOpaque(false);
        panel.setBackgroundColor(Some(&NSColor::clearColor()));
        // the shape lights its own surroundings; a system shadow would trace the glow's alpha
        panel.setHasShadow(false);
        panel.setLevel(NSStatusWindowLevel + 1);
        panel.setHidesOnDeactivate(false);
        panel.setCanBecomeVisibleWithoutLogin(false);
        panel.setBecomesKeyOnlyIfNeeded(true);
        panel.setAcceptsMouseMovedEvents(true);
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        unsafe {
            panel.setReleasedWhenClosed(false);
        }
        let root = Surface::new(mtm, rect(0.0, 0.0, 220.0, 25.0), p, Mode::Compact, 188.0, false);
        let glass = NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(mtm), rect(0.0, 4.0, 220.0, 21.0));
        glass.setMaterial(NSVisualEffectMaterial::Popover);
        glass.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
        glass.setState(NSVisualEffectState::Active);
        glass.setWantsLayer(true);
        if let Some(layer) = glass.layer() {
            layer.setCornerRadius(22.0);
            layer.setMasksToBounds(true);
        }
        glass.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
        root.addSubview(&glass);
        let tint = Surface::new(mtm, rect(0.0, 4.0, 220.0, 21.0), p, Mode::Compact, 188.0, true);
        root.addSubview(&tint);
        let tracking = unsafe {
            NSTrackingArea::initWithRect_options_owner_userInfo(
                NSTrackingArea::alloc(),
                root.bounds(),
                NSTrackingAreaOptions::MouseEnteredAndExited | NSTrackingAreaOptions::MouseMoved | NSTrackingAreaOptions::ActiveAlways | NSTrackingAreaOptions::InVisibleRect,
                Some(&root),
                None,
            )
        };
        root.addTrackingArea(&tracking);
        panel.setContentView(Some(&root));
        let actions = Actions::alloc(mtm).set_ivars(ActionIvars { open });
        let actions = unsafe { msg_send![super(actions), init] };
        let refresh = block2::RcBlock::new(|_: NonNull<NSNotification>| {
            with_island(|i| {
                if i.panel.isVisible() {
                    i.render(MainThreadMarker::new().unwrap(), i.mode, false);
                }
            })
        });
        let pause = block2::RcBlock::new(|_: NonNull<NSNotification>| {
            SESSION_ACTIVE.with(|s| s.set(false));
            with_island(|i| i.dismiss());
        });
        let resume = block2::RcBlock::new(|_: NonNull<NSNotification>| SESSION_ACTIVE.with(|s| s.set(true)));
        let center = NSNotificationCenter::defaultCenter();
        let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
        let queue = NSOperationQueue::mainQueue();
        let observers = unsafe {
            vec![
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSApplicationDidChangeScreenParametersNotification),
                    None,
                    Some(&queue),
                    &refresh,
                ),
                workspace.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceSessionDidResignActiveNotification),
                    None,
                    Some(&queue),
                    &pause,
                ),
                workspace.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceSessionDidBecomeActiveNotification),
                    None,
                    Some(&queue),
                    &resume,
                ),
            ]
        };
        Self {
            panel,
            root,
            tint,
            glass,
            content: None,
            avatars: RefCell::new(HashMap::new()),
            screen_id: None,
            follow_pointer: true,
            motion_target: None,
            motion_active: false,
            visual_mode: Mode::Compact,
            actions,
            queue: IslandQueue::default(),
            mode: Mode::Compact,
            appearance: p,
            hovered: false,
            timer: None,
            pending: None,
            hover_timer: None,
            generation: Rc::new(Cell::new(0)),
            _observers: observers,
        }
    }
    fn arm_hover(&mut self) {
        if !hover_expand_needed(self.mode, self.hovered, self.hover_timer.is_some()) {
            return;
        }
        self.hover_timer = Some(timer(0.16, || {
            with_island(|i| {
                i.hover_timer = None;
                if i.hovered && within(i.panel.frame()) {
                    i.render(MainThreadMarker::new().unwrap(), Mode::Expanded, true);
                }
            })
        }));
    }
    fn schedule(&mut self) {
        if self.pending.is_some() {
            return;
        }
        self.pending = Some(timer(0.08, || {
            with_island(|i| {
                i.pending = None;
                let mode = if i.hovered && i.mode == Mode::Expanded {
                    Mode::Expanded
                } else {
                    Mode::Notice
                };
                i.render(MainThreadMarker::new().unwrap(), mode, true);
            })
        }));
    }
    fn arm(&mut self) {
        stop(&mut self.timer);
        if self.hovered || self.mode == Mode::Compact {
            return;
        }
        self.timer = Some(timer(if self.mode == Mode::Notice { 5.5 } else { 1.3 }, || {
            with_island(|i| {
                i.timer = None;
                if within(i.panel.frame()) {
                    i.hovered = true;
                    i.arm_hover();
                } else if !i.hovered {
                    i.collapse(MainThreadMarker::new().unwrap());
                }
            })
        }));
    }
    fn dismiss(&mut self) {
        stop(&mut self.timer);
        stop(&mut self.pending);
        stop(&mut self.hover_timer);
        self.queue.groups.clear();
        self.hovered = false;
        self.mode = Mode::Compact;
        self.motion_active = false;
        self.motion_target = None;
        let frame = self.panel.frame();
        let target = rect(
            frame.origin.x + frame.size.width / 2.0 - 90.0,
            frame.origin.y + frame.size.height - 4.0,
            180.0,
            4.0,
        );
        let token = self.generation.get() + 1;
        self.generation.set(token);
        let generation = self.generation.clone();
        let panel = self.panel.clone();
        if reduced() || !panel.isVisible() {
            panel.orderOut(None);
            return;
        }
        let animation_panel = panel.clone();
        let changes = block2::RcBlock::new(move |ctx: NonNull<NSAnimationContext>| {
            let ctx = unsafe { ctx.as_ref() };
            ctx.setDuration(0.2);
            ctx.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(0.4, 0.0, 1.0, 1.0)));
            animation_panel.animator().setAlphaValue(0.0);
            animation_panel.animator().setFrame_display(target, true);
        });
        let done = block2::RcBlock::new(move || {
            if generation.get() == token {
                panel.orderOut(None);
                panel.setAlphaValue(1.0);
            }
        });
        NSAnimationContext::runAnimationGroup_completionHandler(&changes, Some(&done));
        eprintln!("[island] dismissed");
    }
    fn collapse(&mut self, mtm: MainThreadMarker) {
        if self.queue.groups.is_empty() {
            self.dismiss();
        } else {
            self.render(mtm, Mode::Compact, true);
        }
    }
    fn row(&self, mtm: MainThreadMarker, parent: &NSView, index: usize, y: f64, width: f64, peek: bool, animate: bool) {
        let g = &self.queue.groups[index];
        // the peek is still notch-black; only the hover-expanded list wears the theme
        let p = if peek { self.appearance.on_black() } else { self.appearance };
        let (name, context) = split_title(&g.title);
        let (platform, _) = ui::platform(&g.key);
        let row = ui::button(
            mtm,
            parent,
            &self.actions,
            "",
            &format!("{name}: {}. Mở hội thoại", g.body),
            rect(8.0, y, width - 16.0, if peek { 96.0 } else { 70.0 }),
            0,
            p,
            Some(&serde_json::to_string(&(&g.key, &g.target)).unwrap()),
        );
        let avatar = ui::avatar(
            mtm,
            &row,
            name,
            &g.key,
            &g.avatar_path,
            rect(10.0, if peek { 24.0 } else { 12.0 }, 40.0, 40.0),
            p,
            animate,
        );
        self.avatars.borrow_mut().insert(g.target.clone(), avatar);
        let title_width = width - if peek { 120.0 } else { 118.0 };
        ui::label(
            mtm,
            &row,
            name,
            rect(62.0, if peek { 10.0 } else { 7.0 }, title_width, 21.0),
            13.0,
            0.4,
            p.foreground,
        );
        ui::label(
            mtm,
            &row,
            &g.body.replace(['\n', '\r'], " "),
            rect(62.0, if peek { 33.0 } else { 28.0 }, width - 94.0, if peek { 33.0 } else { 19.0 }),
            12.5,
            0.0,
            p.foreground,
        );
        let meta = if context.is_empty() {
            platform.to_owned()
        } else {
            format!("{platform} · {context}")
        };
        ui::label(
            mtm,
            &row,
            &meta,
            rect(62.0, if peek { 71.0 } else { 49.0 }, width - if peek { 148.0 } else { 100.0 }, 16.0),
            10.5,
            0.0,
            p.secondary,
        );
        if !peek && g.count > 1 {
            ui::label(
                mtm,
                &row,
                &format!("×{}", g.count),
                rect(width - 65.0, 9.0, 40.0, 18.0),
                10.5,
                0.15,
                p.accent,
            );
        }
    }
    fn build_content(&self, mtm: MainThreadMarker, mode: Mode, w: f64, h: f64, animate: bool) -> Retained<Content> {
        self.avatars.borrow_mut().clear();
        let content = Content::new(mtm, rect(0.0, 0.0, w, h));
        let p = if mode == Mode::Expanded { self.appearance } else { self.appearance.on_black() };
        match mode {
            Mode::Compact => {
                let ink = p;
                let button = ui::button(
                    mtm,
                    &content,
                    &self.actions,
                    "",
                    "Xem các thông báo đã gom",
                    rect(1.0, 3.0, w - 2.0, 21.0),
                    -3,
                    ink,
                    None,
                );
                ui::symbol(
                    mtm,
                    &button,
                    "bubble.left.and.bubble.right.fill",
                    rect(w / 2.0 - 53.0, 4.0, 14.0, 14.0),
                    p.accent,
                );
                ui::label(
                    mtm,
                    &button,
                    &format!("{} tin mới", self.queue.total()),
                    rect(w / 2.0 - 31.0, 2.0, 82.0, 18.0),
                    11.0,
                    0.25,
                    ink.foreground,
                );
                ui::symbol(mtm, &button, "chevron.down", rect(w / 2.0 + 48.0, 7.0, 8.0, 6.0), p.accent);
            }
            Mode::Notice => {
                self.row(mtm, &content, 0, 6.0, w, true, animate);
                let close = ui::button(
                    mtm,
                    &content,
                    &self.actions,
                    "",
                    "Ẩn thông báo này",
                    rect(w - 35.0, 13.0, 24.0, 24.0),
                    -4,
                    p,
                    Some(&serde_json::to_string(&(&self.queue.groups[0].key, &self.queue.groups[0].target)).unwrap()),
                );
                ui::symbol(mtm, &close, "xmark", rect(8.0, 8.0, 8.0, 8.0), p.secondary);
                if self.queue.total() > 1 {
                    let count = ui::button(
                        mtm,
                        &content,
                        &self.actions,
                        &format!("{} mới", self.queue.total()),
                        "Xem tất cả thông báo",
                        rect(w - 70.0, 77.0, 54.0, 21.0),
                        -3,
                        p,
                        None,
                    );
                    count.setContentTintColor(Some(&color(p.accent, 1.0)));
                    ui::symbol(mtm, &count, "chevron.down", rect(43.0, 8.0, 7.0, 5.0), p.accent);
                }
            }
            Mode::Expanded => {
                ui::symbol(mtm, &content, "tray.full.fill", rect(21.0, 18.0, 14.0, 14.0), p.accent);
                ui::label(mtm, &content, "Thông báo", rect(43.0, 15.0, 130.0, 20.0), 12.0, 0.35, p.foreground);
                ui::label(
                    mtm,
                    &content,
                    &format!("{} mới", self.queue.total()),
                    rect(w - 112.0, 17.0, 65.0, 18.0),
                    10.5,
                    0.1,
                    p.secondary,
                );
                let close = ui::button(
                    mtm,
                    &content,
                    &self.actions,
                    "",
                    "Xóa tất cả thông báo",
                    rect(w - 38.0, 12.0, 26.0, 26.0),
                    -1,
                    p,
                    None,
                );
                ui::symbol(mtm, &close, "xmark", rect(9.0, 9.0, 8.0, 8.0), p.secondary);
                ui::rule(mtm, &content, rect(22.0, 41.0, w - 44.0, 0.5), p);
                ui::rule(mtm, &content, rect(w - 49.0, 17.0, 0.5, 16.0), p);
                for index in 0..self.queue.groups.len().min(3) {
                    if index > 0 {
                        ui::rule(mtm, &content, rect(22.0, 43.0 + index as f64 * 72.0, w - 44.0, 0.5), p);
                    }
                    self.row(mtm, &content, index, 43.0 + index as f64 * 72.0, w, false, animate);
                }
                let footer = if self.queue.groups.len() > 3 {
                    format!("Còn {} hội thoại · Mở ChatMin", self.queue.groups.len() - 3)
                } else {
                    "Mở ChatMin".into()
                };
                let all = ui::button(
                    mtm,
                    &content,
                    &self.actions,
                    &footer,
                    "Mở ChatMin",
                    rect((w - 180.0) / 2.0, h - 30.0, 180.0, 24.0),
                    -2,
                    p,
                    None,
                );
                all.setContentTintColor(Some(&color(p.secondary, 1.0)));
                all.setFont(Some(&NSFont::systemFontOfSize(10.5)));
            }
        }
        content
    }
    fn render(&mut self, mtm: MainThreadMarker, mode: Mode, animate: bool) -> bool {
        // Keep pending delivery/hover deadlines through unrelated content updates.
        if mode == Mode::Expanded {
            stop(&mut self.hover_timer);
        }
        stop(&mut self.timer);
        if self.queue.groups.is_empty() {
            self.dismiss();
            return true;
        }
        let Some(screen) = screen(mtm, if self.follow_pointer { None } else { self.screen_id }) else {
            return false;
        };
        let id = screen_id(&screen);
        let screen_changed = self.screen_id.is_some_and(|old| old != id);
        self.screen_id = Some(id);
        self.follow_pointer = false;
        let s = screen.frame();
        let notch = notch_width(&screen);
        let l = layout(mode, self.queue.groups.len(), notch, s.size.width);
        let body_top = (screen.safeAreaInsets().top - 2.0).max(0.0);
        let p = placement_with_width(
            s.origin.x,
            s.origin.y,
            s.size.width,
            s.size.height,
            screen.safeAreaInsets().top,
            l.width + 2.0 * GLOW,
            body_top + l.height + GLOW,
        );
        let target = rect(p.x, p.y, p.width, p.height);
        let old_mode = self.mode;
        self.mode = mode;
        let fresh = !self.panel.isVisible();
        let geometry_changed = self.motion_target != Some(target);
        let keep_motion = self.motion_active && !geometry_changed && !screen_changed && old_mode == mode;
        let animate = animate && !reduced() && !screen_changed && reanimate(old_mode, mode, fresh, geometry_changed);
        if !keep_motion {
            self.generation.set(self.generation.get() + 1);
        }
        let token = self.generation.get();
        if !keep_motion {
            // the shell takes the target look at once: its colour (black vs theme) has to
            // match the new content's ink for the whole transition
            self.visual_mode = mode;
        }
        let visual_mode = self.visual_mode;
        self.root.appearance(self.appearance, visual_mode, notch, body_top);
        self.tint.appearance(self.appearance, visual_mode, notch, body_top);
        self.glass.setHidden(true);
        self.tint.setHidden(true);
        self.glass.setAppearance(
            NSAppearance::appearanceNamed(unsafe {
                if self.appearance.light {
                    NSAppearanceNameAqua
                } else {
                    NSAppearanceNameDarkAqua
                }
            })
            .as_deref(),
        );
        if let Some(old) = self.content.take() {
            old.removeFromSuperview();
        }
        let content = self.build_content(mtm, mode, l.width, l.height, animate);
        content.setFrameOrigin(objc2_foundation::NSPoint::new(GLOW, body_top));
        self.root.addSubview(&content);
        if fresh {
            let small = layout(Mode::Compact, self.queue.groups.len(), notch, s.size.width);
            self.panel.setFrame_display(
                rect(
                    s.origin.x + (s.size.width - small.width) / 2.0 - GLOW,
                    target.origin.y + target.size.height - body_top - small.height - GLOW,
                    small.width + 2.0 * GLOW,
                    body_top + small.height + GLOW,
                ),
                false,
            );
        }
        let body_y = if visual_mode == Mode::Compact || body_top <= 0.0 {
            0.0
        } else {
            body_top + 4.0
        };
        let current = self.root.bounds().size;
        let body_frame = rect(0.0, body_y, current.width, (current.height - body_y).max(1.0));
        self.glass.setFrame(body_frame);
        self.tint.setFrame(body_frame);
        self.panel.setAlphaValue(1.0);
        self.panel.orderFrontRegardless();
        self.motion_target = Some(target);
        if !animate {
            if !keep_motion {
                self.motion_active = false;
                self.panel.setFrame_display(target, true);
            }
            content.setAlphaValue(1.0);
        } else {
            self.motion_active = true;
            content.setAlphaValue(0.0);
            content.setFrameOrigin(objc2_foundation::NSPoint::new(
                GLOW,
                body_top + if mode == Mode::Compact { 0.0 } else { 7.0 },
            ));
            let panel = self.panel.clone();
            let c = content.clone();
            let changes = block2::RcBlock::new(move |context: NonNull<NSAnimationContext>| {
                let context = unsafe { context.as_ref() };
                context.setDuration(if mode == Mode::Compact { 0.25 } else { 0.36 });
                let timing = if mode == Mode::Compact {
                    CAMediaTimingFunction::functionWithControlPoints(0.4, 0.0, 0.2, 1.0)
                } else {
                    CAMediaTimingFunction::functionWithControlPoints(0.22, 1.0, 0.36, 1.0)
                };
                context.setTimingFunction(Some(&timing));
                panel.animator().setFrame_display(target, true);
                c.animator().setFrameOrigin(objc2_foundation::NSPoint::new(GLOW, body_top));
            });
            let generation = self.generation.clone();
            let done = block2::RcBlock::new(move || {
                if generation.get() == token {
                    with_island(|i| {
                        i.motion_active = false;
                        i.visual_mode = i.mode;
                        i.root.appearance(i.appearance, i.mode, notch, body_top);
                        i.tint.appearance(i.appearance, i.mode, notch, body_top);
                        i.hovered = within(i.panel.frame());
                        if i.hovered {
                            i.arm_hover();
                        } else if i.timer.is_none() {
                            i.arm();
                        }
                        eprintln!("[island-motion] settled mode={:?}", i.mode);
                    });
                }
            });
            NSAnimationContext::runAnimationGroup_completionHandler(&changes, Some(&done));
            let c = content.clone();
            let fade = block2::RcBlock::new(move |context: NonNull<NSAnimationContext>| {
                let context = unsafe { context.as_ref() };
                context.setDuration(0.2);
                context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(0.2, 0.0, 0.0, 1.0)));
                c.animator().setAlphaValue(1.0);
            });
            NSAnimationContext::runAnimationGroup(&fade);
        }
        self.content = Some(content);
        self.hovered = within(target);
        if self.hovered {
            self.arm_hover();
        }
        self.arm();
        eprintln!(
            "[island] mode={mode:?} from={old_mode:?} groups={} total={} theme_light={} notch={} width={} height={} key={} active_space={} top={} screen_top={}",
            self.queue.groups.len(),
            self.queue.total(),
            self.appearance.light,
            screen.safeAreaInsets().top,
            l.width,
            l.height,
            self.panel.isKeyWindow(),
            self.panel.isOnActiveSpace(),
            target.origin.y + target.size.height,
            s.origin.y + s.size.height
        );
        true
    }
}

pub fn configure(appearance: Appearance) {
    if !appearance.valid() {
        return;
    }
    APPEARANCE.with(|p| p.set(appearance));
    with_island(|i| {
        i.appearance = appearance;
        if i.panel.isVisible() {
            if i.motion_active {
                let _ = timer(0.4, || {
                    with_island(|i| {
                        if i.panel.isVisible() && !i.motion_active {
                            i.render(MainThreadMarker::new().unwrap(), i.mode, false);
                        }
                    })
                });
            } else {
                i.render(MainThreadMarker::new().unwrap(), i.mode, false);
            }
        }
    });
}
pub fn set_avatar(target: &str, source: &str, path: &str) {
    with_island(|i| {
        if i.queue.set_avatar(target, source, path) {
            if let Some(avatar) = i.avatars.borrow().get(target) {
                avatar.set_photo(path);
            }
            eprintln!("[island] avatar updated; mode={:?}; collapse timer preserved", i.mode);
        }
    });
}
pub fn show(title: &str, body: &str, target: &str, photo: &str, open: Open) -> bool {
    let Some(mtm) = MainThreadMarker::new() else { return false };
    ISLAND.with(|cell| {
        let mut state = cell.borrow_mut();
        let i = state.get_or_insert_with(|| Island::new(mtm, open));
        if !SESSION_ACTIVE.with(Cell::get) {
            return true;
        }
        if i.queue.push_with_avatar(title, body, target, photo) {
            i.follow_pointer = true;
            i.schedule();
        }
        true
    })
}
pub fn clear(chat: Option<&str>) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    with_island(|i| {
        if let Some(chat) = chat {
            if i.queue.remove_chat(chat) {
                i.render(mtm, i.mode, true);
            }
        } else {
            i.dismiss();
        }
    });
}
/// A provider-free executable uses this exact native surface for local visual/interaction QA.
#[cfg(debug_assertions)]
pub fn preview() {
    // Only the provider-free QA harness redirects stderr; production uses app.log.
    if let Ok(log) = std::fs::File::create(std::env::temp_dir().join("chatmin-island-preview.log")) {
        use std::os::fd::AsRawFd;
        unsafe {
            libc::dup2(log.as_raw_fd(), 2);
        }
    }
    let mtm = MainThreadMarker::new().expect("preview must run on the main thread");
    if let Ok(raw) = std::fs::read(std::env::temp_dir().join("chatmin-island-preview-appearance.json")) {
        if let Ok(appearance) = serde_json::from_slice::<Appearance>(&raw) {
            configure(appearance);
        }
    }
    if let Ok(id) = std::fs::read_to_string(std::env::temp_dir().join("chatmin-island-preview-display")) {
        PREVIEW_DISPLAY.with(|p| p.set(id.trim().parse().ok()));
    }
    for s in NSScreen::screens(mtm).iter() {
        eprintln!(
            "[island-display] id={} frame={:?} notch={}",
            screen_id(&s),
            s.frame(),
            s.safeAreaInsets().top
        );
    }
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    let callback: Open = Rc::new(|target| {
        println!("ISLAND_OPEN {target:?}");
        use std::io::Write;
        if let Ok(mut log) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(std::env::temp_dir().join("chatmin-island-preview-events.log"))
        {
            let _ = writeln!(log, "ISLAND_OPEN {target:?}");
        }
    });
    let photo = std::fs::read_to_string(std::env::temp_dir().join("chatmin-island-preview-photo")).unwrap_or_default();
    let photo = photo.trim();
    show(
        "Linh Nguyễn · Backend Go",
        "Anh xem giúp em bản cập nhật mới nhé. Phần notification đã gom về notch rồi.",
        "tg-demo|42\nm1\nthread1",
        photo,
        callback.clone(),
    );
    show(
        "Linh Nguyễn · Backend Go",
        "Có thêm hai tin trong cùng hội thoại — không xếp chồng banner.",
        "tg-demo|42\nm2\nthread1",
        photo,
        callback.clone(),
    );
    show(
        "Minh Trần · Product",
        "Bản demo đã sẵn sàng để review 👋",
        "gc-demo|spaces/product\nm3\nthread2",
        photo,
        callback.clone(),
    );
    let scene = std::fs::read_to_string(std::env::temp_dir().join("chatmin-island-preview-scene")).unwrap_or_default();
    if !photo.is_empty() {
        let output = std::env::temp_dir().join("chatmin-island-preview-thumb.png");
        let _ = std::fs::remove_file(&output);
        if let Some(path) = crate::island_media::thumbnail_file(std::path::Path::new(photo), &output) {
            let path = path.to_string_lossy().into_owned();
            if scene.trim() == "late-photo" {
                let photo = photo.to_owned();
                let _ = timer(1.2, move || {
                    set_avatar("tg-demo|42\nm2\nthread1", &photo, &path);
                    set_avatar("gc-demo|spaces/product\nm3\nthread2", &photo, &path);
                });
            } else {
                set_avatar("tg-demo|42\nm2\nthread1", photo, &path);
                set_avatar("gc-demo|spaces/product\nm3\nthread2", photo, &path);
            }
        }
    }
    println!("ISLAND_READY");
    if scene.trim() == "motion-regression" {
        let cb = callback.clone();
        let photo = photo.to_owned();
        let _ = timer(0.20, move || {
            show(
                "Linh Nguyễn · Backend Go",
                "Tin mới trong lúc panel đang mở",
                "tg-demo|42\nm4\nthread1",
                &photo,
                cb.clone(),
            );
        });
        let _ = timer(1.0, || {
            with_island(|i| {
                i.render(MainThreadMarker::new().unwrap(), Mode::Expanded, true);
            })
        });
        let _ = timer(2.0, || {
            with_island(|i| {
                i.collapse(MainThreadMarker::new().unwrap());
            })
        });
    }
    if scene.trim() == "maintenance" {
        let _ = timer(0.02, || {
            clear(Some("unrelated|chat"));
        });
    }
    if scene.trim() == "expanded" {
        let _ = timer(0.65, || {
            with_island(|i| {
                i.render(MainThreadMarker::new().unwrap(), Mode::Expanded, true);
            })
        });
    }
    if scene.trim() == "compact" {
        let _ = timer(0.65, || {
            with_island(|i| {
                i.collapse(MainThreadMarker::new().unwrap());
            })
        });
    }
    for t in [0.10, 0.18, 0.30, 0.50, 0.75, 1.18, 1.35, 2.05, 2.12, 2.24, 2.40, 5.8] {
        let _ = timer(t, move || {
            with_island(|i| {
                let opacity = i
                    .content
                    .as_ref()
                    .and_then(|c| c.layer())
                    .and_then(|l| unsafe { l.presentationLayer() })
                    .map(|l| l.opacity());
                eprintln!(
                    "[island-motion] t={t} frame={:?} opacity={opacity:?} shell={:?} moving={}",
                    i.panel.frame(),
                    i.visual_mode,
                    i.motion_active
                );
            })
        });
    }
    app.run();
}
