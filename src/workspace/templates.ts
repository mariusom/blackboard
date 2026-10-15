import type { Workspace } from "./model"
import { DEFAULT_TOKENS } from "./tokens"

export const BLANK_HTML = `<main style="min-height:100vh;display:grid;place-items:center;background:var(--color-surface,#fff);color:var(--color-muted,#a5a5a5);font:14px var(--font-body,system-ui)"><div style="text-align:center"><div style="font-size:32px;margin-bottom:16px">+</div>Your next idea starts here.</div></main>`

export const LEGACY_STUDIO_HTML = `<style>
*{box-sizing:border-box}body{margin:0;background:#f6f4ef;color:#22261f;font-family:-apple-system,BlinkMacSystemFont,sans-serif}nav{display:flex;align-items:center;justify-content:space-between;padding:28px 38px;font-size:12px}nav strong{font-size:17px;letter-spacing:-.5px}nav span{color:#62665e}.hero{padding:34px 38px 28px;display:grid;grid-template-columns:1.1fr 1fr;gap:32px;align-items:center}.eyebrow{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#68725d}h1{font-family:Georgia,serif;font-weight:400;font-size:61px;line-height:1.01;letter-spacing:-2.8px;margin:21px 0}p{font-size:13px;line-height:1.8;color:#6c7067;max-width:250px}.cta{display:inline-block;margin-top:18px;background:#303d2b;color:white;padding:13px 20px;border-radius:4px;font-size:11px}.art{height:318px;background:#e3e7d8;border-radius:130px 130px 10px 10px;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center}.circle{position:absolute;width:240px;height:240px;border:1px solid #b7c0a8;border-radius:50%;top:39px}.stem{position:absolute;background:#69775a;width:2px;height:214px;top:90px;transform:rotate(-13deg)}.leaf{position:absolute;width:72px;height:130px;background:#899673;border-radius:100% 0 100% 0;transform:rotate(-24deg);top:86px;left:67px}.leaf.two{background:#536946;transform:rotate(51deg);top:153px;left:125px;width:63px;height:111px}.foot{border-top:1px solid #dedfd5;margin:18px 38px 0;padding-top:23px;display:flex;justify-content:space-between;font-size:9px;letter-spacing:1px;color:#7b8171}.dot{display:inline-block;width:6px;height:6px;background:#778968;border-radius:50%;margin-right:6px}@media(max-width:480px){nav{padding:24px}.hero{display:flex;flex-direction:column;padding:15px 24px;align-items:stretch;gap:25px}h1{font-size:48px;margin:17px 0}p{font-size:12px;max-width:100%}.art{height:235px;border-radius:120px 120px 8px 8px}.circle{top:14px;width:210px;height:210px}.stem{top:55px}.leaf{top:50px;left:76px}.leaf.two{top:112px;left:132px}.foot{margin:20px 24px;font-size:8px}nav .links{display:none}}
</style>
<nav><strong>forma<span style="color:#758366">®</span></strong><span class="links">Our approach &nbsp;&nbsp;&nbsp;&nbsp; Selected work &nbsp;&nbsp;&nbsp;&nbsp; Let's talk ↗</span><span style="font-size:10px">EST. 2026</span></nav>
<section class="hero"><div><div class="eyebrow">Independent design studio</div><h1>Space for<br>good things.</h1><p>Thoughtful digital experiences for a world that could use a little more intention.</p><a class="cta">Explore our work &nbsp; ↗</a></div><div class="art"><div class="circle"></div><div class="stem"></div><div class="leaf"></div><div class="leaf two"></div></div></section>
<div class="foot"><span><i class="dot"></i> OPEN FOR COLLABORATIONS</span><span>DESIGNED WITH INTENTION</span></div>`

const replacements: Readonly<Record<string, string>> = {
  "#f6f4ef": "color-surface", "#22261f": "color-ink", "#6c7067": "color-muted", "#303d2b": "color-brand",
  "#e3e7d8": "color-art", "#899673": "color-leaf", "#536946": "color-leaf-dark",
}
export const STUDIO_HTML = LEGACY_STUDIO_HTML.replace(/#[a-f0-9]{6}/g, value => replacements[value] ? `var(--${replacements[value]},${value})` : value)
  .replace("font-family:-apple-system,BlinkMacSystemFont,sans-serif", "font-family:var(--font-body,-apple-system,BlinkMacSystemFont,sans-serif)")
  .replace("font-family:Georgia,serif", "font-family:var(--font-display,Georgia,serif)")
  .replace("font-size:61px", "font-size:var(--size-display,61px)")
  .replace("font-size:48px", "font-size:var(--size-display-mobile,48px)")
  .replaceAll("font-size:13px", "font-size:var(--size-body,13px)")
  .replace("border-radius:4px", "border-radius:var(--radius-sm,4px)")
  .replaceAll("padding:24px", "padding:var(--space-lg,24px)")
  .replace("color:white", "color:var(--color-on-brand,white)")

export const INITIAL_WORKSPACE: Workspace = {
  version: 2, name: "Untitled workspace", tokens: DEFAULT_TOKENS, tokensRevision: 0, boards: [
    { id: "desktop", name: "Forma · Desktop", x: 0, y: 0, width: 760, height: 560, html: STUDIO_HTML, revision: 0 },
    { id: "mobile", name: "Forma · Mobile", x: 840, y: 0, width: 340, height: 740, html: STUDIO_HTML, revision: 0 },
  ],
}

export const EMPTY_WORKSPACE: Workspace = { version: 2, name: "Untitled workspace", tokens: DEFAULT_TOKENS, tokensRevision: 0, boards: [] }
