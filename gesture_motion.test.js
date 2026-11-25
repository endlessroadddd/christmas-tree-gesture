const assert = require('node:assert/strict');
const { FingerCircleTracker, PinchSlideTracker, PinchGestureController, PhotoRevealController, PHOTO_REVEAL_THRESHOLD } = require('./gesture_motion.js');

function run(points, interval = 34) {
  const tracker = new FingerCircleTracker();
  const events = [];
  points.forEach(([x,y],i) => {
    const event = tracker.add(x,y,i*interval);
    if (event) events.push(event.direction);
  });
  return events;
}

function circle(sign) {
  return Array.from({length:70},(_,i)=>{
    const angle=sign*i/69*Math.PI*2;
    return [.5+.16*Math.cos(angle),.5+.16*Math.sin(angle)];
  });
}

assert.deepEqual(run(circle(1)),['clockwise']);
assert.deepEqual(run(circle(-1)),['counterclockwise']);
assert.deepEqual(run(circle(1),55),['clockwise']);
assert.deepEqual(run(Array.from({length:70},(_,i)=>[.2+i*.006,.5])),[]);
assert.deepEqual(run(Array.from({length:70},(_,i)=>[.5+Math.sin(i*2)*.003,.5+Math.cos(i*3)*.003])),[]);
assert.deepEqual(run(circle(1),100),[]); // A seven-second circle is outside the recognition window.
const slide=new PinchSlideTracker();
slide.begin(.8);
assert.equal(slide.add(.75),false);
assert.equal(slide.add(.70),true); // A held pinch moved left far enough (>= 0.095).
assert.equal(slide.add(.50),false); // One continuous slide changes one photo.
assert.equal(slide.add(.56),false); // Moving right >= 0.045 re-arms another slide.
assert.equal(slide.add(.45),true);
slide.reset();
assert.equal(slide.add(.5),false);
assert.equal(slide.add(.54),false);
assert.equal(slide.add(.48),false);

// PinchGestureController: preserves early slide, survives jitter, debounces brief drops.
const gesture = new PinchGestureController();
assert.equal(gesture.update({ pinchAmount: 0.70, x: 0.80, now: 100, isOpen: false }).action, 'none');
assert.equal(gesture.update({ pinchAmount: 0.70, x: 0.75, now: 220, isOpen: false }).action, 'open');
// Does not spam open when isOpen stays false (e.g. 0 photos).
assert.equal(gesture.update({ pinchAmount: 0.70, x: 0.74, now: 260, isOpen: false }).action, 'none');
// Early leftward drift during open delay (0.80 -> 0.75) is preserved when continuing left.
assert.equal(gesture.update({ pinchAmount: 0.44, x: 0.70, now: 280, isOpen: true }).action, 'slide'); // Mid-zone jitter stays open & slides.
// Brief drop below holdThreshold (< 180ms) must not close or reset slide tracker.
assert.equal(gesture.update({ pinchAmount: 0.20, x: 0.75, now: 300, isOpen: true }).action, 'none');
assert.equal(gesture.update({ pinchAmount: 0.20, x: 0.76, now: 390, isOpen: true }).action, 'none');
// Recovering pinch back above holdThreshold re-arms and completes slide cleanly.
assert.equal(gesture.update({ pinchAmount: 0.45, x: 0.76, now: 410, isOpen: true }).action, 'none');
assert.equal(gesture.update({ pinchAmount: 0.45, x: 0.65, now: 430, isOpen: true }).action, 'slide');
// Sustained release (>= 180ms) closes photo.
assert.equal(gesture.update({ pinchAmount: 0.20, x: 0.65, now: 450, isOpen: true }).action, 'none');
assert.equal(gesture.update({ pinchAmount: 0.20, x: 0.65, now: 640, isOpen: true }).action, 'close');
// Closed with pinchAmount < circleThreshold allows circle detection.
const closed = gesture.update({ pinchAmount: 0.25, x: 0.50, now: 700, isOpen: false });
assert.equal(closed.action, 'none');
assert.equal(closed.allowCircle, true);

// Photos stay hidden until the tree crosses 2/3 (only 1/3 remaining) during assembly.
const reveal = new PhotoRevealController();
assert.equal(PHOTO_REVEAL_THRESHOLD, 2 / 3);
assert.equal(reveal.update(0, 1).visible, false);
assert.equal(reveal.update(0.5, 1).visible, false);
assert.equal(reveal.update(0.66, 1).visible, false);
const crossed = reveal.update(0.70, 1);
assert.equal(crossed.justRevealed, true);
assert.equal(crossed.visible, true);
assert.ok(crossed.alpha > 0 && crossed.alpha < 1);
assert.equal(reveal.update(1, 1).alpha, 1);

// Adding photos when the tree is already assembled must not show them immediately.
reveal.onPhotosAdded();
assert.equal(reveal.update(1, 1).visible, false);
assert.equal(reveal.update(1, 1).alpha, 0);
assert.equal(reveal.shouldRestartAssembly(1), true);

// Restarting assembly keeps photos hidden until crossing 2/3 again.
reveal.resetAssembly();
assert.equal(reveal.update(0.3, 1).visible, false);
reveal.onPhotosAdded(); // Adding photos mid-assembly still waits for 2/3.
assert.equal(reveal.update(0.65, 1).visible, false);
assert.equal(reveal.update(0.72, 1).visible, true);

// Dissipating below 2/3 hides photos and requires crossing 2/3 again on next assembly.
assert.equal(reveal.update(0.60, 0).visible, false);
assert.equal(reveal.update(0.20, 0).visible, false);
assert.equal(reveal.shouldRestartAssembly(0.20), false);
assert.equal(reveal.update(0.65, 1).visible, false);
assert.equal(reveal.update(0.75, 1).justRevealed, true);

console.log('Circle, held-pinch slide, and photo reveal checks passed');
