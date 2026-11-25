// Detect a deliberate circle traced by one fingertip in the mirrored camera view.
// Screen coordinates have x to the right and y down, so positive angle is clockwise.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GestureMotion = api;
})(globalThis, function () {
  function analyzeCircle(samples) {
    if (samples.length < 14) return null;
    const duration = samples.at(-1).time - samples[0].time;
    if (duration < 420 || duration > 4200) return null;
    const xs = samples.map(p => p.x), ys = samples.map(p => p.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spanX < .105 || spanY < .105) return null;
    const cx = xs.reduce((a,b)=>a+b,0)/xs.length;
    const cy = ys.reduce((a,b)=>a+b,0)/ys.length;
    const radii = samples.map(p => Math.hypot(p.x-cx,p.y-cy));
    const meanRadius = radii.reduce((a,b)=>a+b,0)/radii.length;
    if (meanRadius < .045) return null;
    let signed = 0, absolute = 0;
    for (let i=1;i<samples.length;i++) {
      let a = Math.atan2(samples[i].y-cy,samples[i].x-cx) - Math.atan2(samples[i-1].y-cy,samples[i-1].x-cx);
      if (a > Math.PI) a -= Math.PI*2;
      if (a < -Math.PI) a += Math.PI*2;
      signed += a; absolute += Math.abs(a);
    }
    const consistency = Math.abs(signed)/(absolute || 1);
    if (Math.abs(signed) < Math.PI*1.55 || consistency < .72) return null;
    return { direction: signed > 0 ? 'clockwise' : 'counterclockwise', radians: signed, consistency };
  }
  class FingerCircleTracker {
    constructor() { this.samples=[]; this.lastAt=0; this.cooldownUntil=0; this.smoothed=null; }
    reset() { this.samples=[]; this.smoothed=null; this.lastAt=0; }
    add(x,y,time) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(time)) return null;
      if (this.lastAt && time-this.lastAt > 420) this.reset();
      this.lastAt=time;
      if (time < this.cooldownUntil) return null;
      this.smoothed = this.smoothed ? {x:this.smoothed.x*.55+x*.45,y:this.smoothed.y*.55+y*.45} : {x,y};
      if (this.samples.length && time-this.samples.at(-1).time < 24) return null;
      this.samples.push({x:this.smoothed.x,y:this.smoothed.y,time});
      while(this.samples.length && time-this.samples[0].time > 3800) this.samples.shift();
      const result=analyzeCircle(this.samples);
      if (result) { this.samples=[]; this.cooldownUntil=time+850; }
      return result;
    }
  }
  class PinchSlideTracker {
    constructor(slideThreshold = 0.095, rearmThreshold = 0.045) {
      this.slideThreshold = slideThreshold;
      this.rearmThreshold = rearmThreshold;
      this.reset();
    }
    reset() { this.anchorX=null; this.leftmostX=null; this.armed=true; }
    begin(x) { this.anchorX=x; this.leftmostX=x; this.armed=true; }
    add(x) {
      if (!Number.isFinite(x)) return false;
      if (this.anchorX===null) { this.begin(x); return false; }
      if (!this.armed) {
        this.leftmostX=Math.min(this.leftmostX,x);
        if (x-this.leftmostX>=this.rearmThreshold) { this.anchorX=x; this.armed=true; }
        return false;
      }
      this.anchorX=Math.max(this.anchorX,x);
      if (this.anchorX-x<this.slideThreshold) return false;
      this.armed=false;
      this.leftmostX=x;
      return true;
    }
  }
  class PinchGestureController {
    constructor(options = {}) {
      this.enterThreshold = options.enterThreshold ?? 0.56;
      this.holdThreshold = options.holdThreshold ?? 0.36;
      this.circleThreshold = options.circleThreshold ?? 0.42;
      this.openDelayMs = options.openDelayMs ?? 110;
      this.releaseDelayMs = options.releaseDelayMs ?? 180;
      this.slideTracker = new PinchSlideTracker(options.slideThreshold ?? 0.095, options.rearmThreshold ?? 0.045);
      this.reset();
    }
    reset() {
      this.pinchStartedAt = 0;
      this.pinchStartX = null;
      this.releaseStartedAt = 0;
      this.openAttempted = false;
      this.slideTracker.reset();
    }
    update({ pinchAmount, x, now, isOpen }) {
      if (isOpen) {
        if (pinchAmount >= this.holdThreshold) {
          this.releaseStartedAt = 0;
          if (this.slideTracker.anchorX === null) this.slideTracker.begin(x);
          const slid = this.slideTracker.add(x);
          return { action: slid ? 'slide' : 'none', allowCircle: false };
        }
        if (!this.releaseStartedAt) this.releaseStartedAt = now;
        if (now - this.releaseStartedAt >= this.releaseDelayMs) {
          this.reset();
          return { action: 'close', allowCircle: false };
        }
        return { action: 'none', allowCircle: false };
      }
      this.releaseStartedAt = 0;
      if (pinchAmount >= this.enterThreshold) {
        if (!this.pinchStartedAt) {
          this.pinchStartedAt = now;
          this.pinchStartX = x;
        }
        if (!this.openAttempted && now - this.pinchStartedAt >= this.openDelayMs) {
          this.openAttempted = true;
          this.slideTracker.begin(this.pinchStartX ?? x);
          return { action: 'open', allowCircle: false };
        }
        return { action: 'none', allowCircle: false };
      }
      if (pinchAmount < this.circleThreshold) {
        this.pinchStartedAt = 0;
        this.pinchStartX = null;
        this.openAttempted = false;
        this.slideTracker.reset();
        return { action: 'none', allowCircle: true };
      }
      this.pinchStartedAt = 0;
      this.pinchStartX = null;
      this.openAttempted = false;
      return { action: 'none', allowCircle: false };
    }
  }
  const PHOTO_REVEAL_THRESHOLD = 2 / 3;
  const PHOTO_FADE_SPAN = 0.18;
  class PhotoRevealController {
    constructor(threshold = PHOTO_REVEAL_THRESHOLD, fadeSpan = PHOTO_FADE_SPAN) {
      this.threshold = threshold;
      this.fadeSpan = fadeSpan;
      this.revealed = false;
      this.prevReveal = 0;
    }
    onPhotosAdded() { this.revealed = false; }
    resetAssembly() { this.revealed = false; this.prevReveal = 0; }
    shouldRestartAssembly(reveal) {
      return reveal >= 0.98 || (!this.revealed && reveal >= this.threshold);
    }
    update(reveal, targetAssembly = 1) {
      const justRevealed = !this.revealed && targetAssembly >= this.threshold && this.prevReveal < this.threshold && reveal >= this.threshold;
      if (justRevealed) this.revealed = true;
      else if (reveal < this.threshold) this.revealed = false;
      this.prevReveal = reveal;
      const alpha = this.revealed ? Math.max(0, Math.min(1, (reveal - this.threshold) / this.fadeSpan)) : 0;
      return { visible: this.revealed && alpha > 0, alpha, justRevealed };
    }
  }
  return { analyzeCircle, FingerCircleTracker, PinchSlideTracker, PinchGestureController, PhotoRevealController, PHOTO_REVEAL_THRESHOLD };
});
