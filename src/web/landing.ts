const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// pointer-follow tilt on the wrapper layer; the inner card owns swipe motion
const tilt = document.getElementById("demo-tilt");
const stage = tilt?.parentElement;
if (tilt && stage && !reduced && window.matchMedia("(pointer: fine)").matches) {
  let raf = 0;
  let targetX = 0, targetY = 0, currentX = 0, currentY = 0;

  const tick = () => {
    currentX += (targetX - currentX) * 0.12;
    currentY += (targetY - currentY) * 0.12;
    tilt.style.transform = `rotate(2.5deg) rotateX(${currentY}deg) rotateY(${currentX}deg)`;
    if (Math.abs(targetX - currentX) > 0.01 || Math.abs(targetY - currentY) > 0.01) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
    }
  };
  const retarget = (x: number, y: number) => {
    targetX = x; targetY = y;
    if (!raf) raf = requestAnimationFrame(tick);
  };
  stage.addEventListener("pointermove", (e) => {
    const r = tilt.getBoundingClientRect();
    retarget(
      ((e.clientX - (r.left + r.width / 2)) / r.width) * 10,
      ((e.clientY - (r.top + r.height / 2)) / r.height) * -8,
    );
  });
  stage.addEventListener("pointerleave", () => retarget(0, 0));
}

// self-playing swipe demo
const card = document.getElementById("demo-card");
const teamEl = document.getElementById("demo-team");
const qEl = document.getElementById("demo-q");
const yesEl = document.getElementById("demo-yes");
const noEl = document.getElementById("demo-no");
const stampEl = document.getElementById("demo-stamp");

const DEMO: { team: string; q: string; dir: "right" | "left" }[] = [
  { team: 'MEXICO <span class="demo-vs">VS</span> ENGLAND', q: "Will Mexico score more goals than England?", dir: "right" },
  { team: 'MEXICO <span class="demo-vs">VS</span> ENGLAND', q: "Will there be a red card in this match?", dir: "left" },
  { team: 'ARGENTINA <span class="demo-vs">VS</span> EGYPT', q: "Last 10 matches averaged 9 corners. Higher or Lower?", dir: "right" },
];

if (card && teamEl && qEl && yesEl && noEl && !reduced) {
  let i = 0;
  let visible = true;
  let hovered = false;
  new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; }, { threshold: 0.3 })
    .observe(card);
  stage?.addEventListener("pointerenter", () => { hovered = true; });
  stage?.addEventListener("pointerleave", () => { hovered = false; });

  const step = () => {
    if (document.hidden || !visible || hovered) return;
    const current = DEMO[i % DEMO.length];
    if (!current) return;
    const flashEl = current.dir === "right" ? yesEl : noEl;
    flashEl.classList.add("flash");
    if (stampEl) {
      stampEl.textContent = current.dir === "right" ? "YES" : "NO";
      stampEl.classList.remove("yes", "no");
      stampEl.classList.add(current.dir === "right" ? "yes" : "no", "show");
    }

    window.setTimeout(() => {
      card.classList.add(current.dir === "right" ? "swipe-out-right" : "swipe-out-left");
      window.setTimeout(() => {
        i += 1;
        const next = DEMO[i % DEMO.length];
        if (!next) return;
        flashEl.classList.remove("flash");
        stampEl?.classList.remove("show");
        card.classList.remove("swipe-out-right", "swipe-out-left");
        card.classList.add("swipe-in");
        teamEl.innerHTML = next.team;
        qEl.textContent = next.q;
        void card.offsetWidth;
        card.classList.add("swipe-settle");
        card.classList.remove("swipe-in");
        window.setTimeout(() => card.classList.remove("swipe-settle"), 360);
      }, 430);
    }, 340);
  };

  const timer = window.setInterval(step, 5600);
  window.addEventListener("pagehide", () => window.clearInterval(timer));
}

// scroll-staggered strip entrance
const items = Array.from(document.querySelectorAll<HTMLElement>(".strip-item"));
if (items.length) {
  if (reduced) {
    items.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            el.style.setProperty("--s", String(items.indexOf(el)));
            el.classList.add("in");
            io.unobserve(el);
          }
        }
      },
      { threshold: 0.25 },
    );
    items.forEach((el) => io.observe(el));
  }
}
