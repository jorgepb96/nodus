// A synthetic cursor for the recording.
//
// CDP's screencast composites the page only — the operating system pointer is
// never in the frame. A tutorial where clicks happen with no visible cursor is
// unreadable, so we draw our own: a soft dot that glides to each target and
// pulses when it clicks. Being a DOM element it also moves far more smoothly
// than a real pointer, which is what you want on screen.

export const CURSOR_CSS = `
.nodus-tutorial-spot {
  position: fixed; z-index: 2147483645; pointer-events: none;
  border-radius: 12px;
  border: 2px solid rgba(129,140,248,.95);
  box-shadow: 0 0 0 4px rgba(129,140,248,.18), 0 0 26px 6px rgba(129,140,248,.32);
  transition: opacity .16s ease;
  opacity: 0;
}
.nodus-tutorial-spot.on { opacity: 1; }
#nodus-tutorial-cursor {
  position: fixed; z-index: 2147483647; top: 0; left: 0;
  width: 22px; height: 22px; margin: -11px 0 0 -11px;
  border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle at 35% 35%, #fff 0 18%, rgba(255,255,255,.92) 30%, rgba(255,255,255,.55) 55%, rgba(255,255,255,0) 70%);
  box-shadow: 0 0 0 2px rgba(0,0,0,.35), 0 2px 10px rgba(0,0,0,.5);
  transition: transform .06s linear;
  will-change: left, top;
}
#nodus-tutorial-cursor.clicking { transform: scale(.8); }
.nodus-tutorial-ripple {
  position: fixed; z-index: 2147483646; pointer-events: none;
  width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
  border: 2px solid rgba(129,140,248,.9);
  animation: nodus-tutorial-ripple .55s ease-out forwards;
}
@keyframes nodus-tutorial-ripple {
  from { opacity: .95; transform: scale(.6); }
  to   { opacity: 0;   transform: scale(4.2); }
}
`;

/** Injected once per page load. Exposes window.__tutorialCursor for the driver. */
export function installCursor() {
  const style = document.createElement('style');
  style.textContent = window.__TUTORIAL_CURSOR_CSS__;
  document.head.appendChild(style);

  const dot = document.createElement('div');
  dot.id = 'nodus-tutorial-cursor';
  document.body.appendChild(dot);

  let x = window.innerWidth / 2;
  let y = window.innerHeight * 0.62;
  const place = () => {
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
  };
  place();
  let highlightFrame=0;

  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  window.__tutorialCursor = {
    position: () => ({ x, y }),
    /** Glide to a point over `ms`, resolving when it arrives. */
    moveTo(tx, ty, ms = 620) {
      return new Promise((resolve) => {
        const x0 = x;
        const y0 = y;
        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          const e = easeInOut(p);
          x = x0 + (tx - x0) * e;
          y = y0 + (ty - y0) * e;
          place();
          if (p < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    },
    /**
     * Ring the element the narration is talking about.
     *
     * This exists so the tutorial can point at things without moving the camera.
     * A push-in is a strong gesture and reads as meaningful; using it for every
     * mention made the video feel restless and, worse, implied significance where
     * there was none. Highlighting keeps the whole screen in view — the viewer
     * still sees where they are — while making the subject unmistakable.
     */
    /**
     * Takes a rectangle, not a selector. The driver resolves targets with
     * Playwright locators — which support text matching, as in
     * `button:has-text("Academic")` — and those are not valid CSS, so
     * `querySelector` cannot be given them.
     */
    highlight(r) {
      if (!r) return false;
      const pad = 8;
      const spot = document.createElement('div');
      spot.className = 'nodus-tutorial-spot';
      spot.style.left = `${r.x - pad}px`;
      spot.style.top = `${r.y - pad}px`;
      spot.style.width = `${r.width + pad * 2}px`;
      spot.style.height = `${r.height + pad * 2}px`;
      document.body.appendChild(spot);
      requestAnimationFrame(() => spot.classList.add('on'));
      return true;
    },
    /** Follow a live control through scroll and layout; never retain its old box. */
    highlightElement(element) {
      this.clearHighlights();
      const spot=document.createElement('div');spot.className='nodus-tutorial-spot';document.body.appendChild(spot);
      let last='',stableAt=performance.now();
      const track=()=>{
        if(!element.isConnected){spot.remove();return;}
        const raw=element.getBoundingClientRect();
        let left=Math.max(0,raw.left),top=Math.max(0,raw.top),right=Math.min(innerWidth,raw.right),bottom=Math.min(innerHeight,raw.bottom);
        for(let p=element.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/hidden|clip|auto|scroll/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}
        const r={x:left,y:top,width:right-left,height:bottom-top,bottom},key=[r.x,r.y,r.width,r.height].map(n=>Math.round(n*2)/2).join(',');
        if(last!==key){stableAt=performance.now();last=key;spot.classList.remove('on');}
        const shown=!element.closest('[hidden],[inert],[aria-hidden="true"]')&&element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&r.width>1&&r.height>1;
        if(shown&&performance.now()-stableAt>=90){Object.assign(spot.style,{left:`${r.x-8}px`,top:`${r.y-8}px`,width:`${r.width+16}px`,height:`${r.height+16}px`});spot.classList.add('on');}else spot.classList.remove('on');
        highlightFrame=requestAnimationFrame(track);
      };track();return true;
    },
    clearHighlights() {
      cancelAnimationFrame(highlightFrame);
      for (const el of document.querySelectorAll('.nodus-tutorial-spot')) {
        el.remove();
      }
    },
    /** Visual feedback only; the real click is dispatched by Playwright. */
    pulse() {
      dot.classList.add('clicking');
      const ripple = document.createElement('div');
      ripple.className = 'nodus-tutorial-ripple';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      document.body.appendChild(ripple);
      setTimeout(() => {
        dot.classList.remove('clicking');
        ripple.remove();
      }, 560);
    },
  };
}
