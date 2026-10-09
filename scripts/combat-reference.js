// Table house rules supplied by the GM. These values are informational only.
export const COMBAT_REFERENCE_HTML = `
  <summary>Памятка: дистанции и движение</summary>
  <div class="yze-action-widget__reference-body" tabindex="0" aria-label="Памятка по бою">
    <article>
      <h4>Нулевая · Arms Length (AL)</h4>
      <p>В непосредственной близости · 1 клетка · 0–2 м.</p>
      <dl><dt>Бегство</dt><dd>−2</dd><dt>Стрельба</dt><dd>−3, если противник в сознании</dd><dt>Скрытая атака</dt><dd>−2</dd></dl>
    </article>
    <article>
      <h4>Ближняя · Near (N)</h4>
      <p>До нескольких метров · 2–3 клетки · 2–6 м.</p>
      <dl><dt>Бегство</dt><dd>−1</dd><dt>Стрельба</dt><dd>+0</dd><dt>Скрытая атака</dt><dd>−1</dd></dl>
    </article>
    <article>
      <h4>Средняя · Short (S)</h4>
      <p>До пары десятков метров · 4–12 клеток · &gt;6–25 м.</p>
      <dl><dt>Бегство</dt><dd>+0</dd><dt>Стрельба</dt><dd>−1</dd><dt>Скрытая атака</dt><dd>+0</dd></dl>
    </article>
    <article>
      <h4>Дальняя · Long (L)</h4>
      <p>До нескольких сотен метров · &gt;12 клеток · &gt;25 м.</p>
      <dl><dt>Бегство</dt><dd>+1</dd><dt>Стрельба</dt><dd>−2</dd><dt>Скрытая атака</dt><dd>+1</dd></dl>
    </article>
    <article>
      <h4>Предельная · Distant (D)</h4>
      <p>В пределах видимости · от 100 м.</p>
      <dl><dt>Бегство</dt><dd>Автоматически</dd><dt>Стрельба</dt><dd>−5</dd></dl>
    </article>
    <article>
      <h4>Пространство и батлмап</h4>
      <p>Побег: открытое пространство <strong>−1</strong>; закрытое <strong>+1</strong>.</p>
      <p><strong>1 маневр = 10 м. 1 клетка = 2 м.</strong></p>
      <dl><dt>AL ↔ N</dt><dd>1 маневр</dd><dt>N ↔ S</dt><dd>1 маневр</dd><dt>S ↔ L</dt><dd>2 маневра</dd><dt>L ↔ D</dt><dd>2 маневра</dd></dl>
      <p>Переходы действуют в обе стороны.</p>
    </article>
  </div>`;

/** Native details keeps keyboard navigation and disclosure state in the DOM. */
export function createCombatReference({ open = false, onToggle } = {}) {
  const details = document.createElement("details");
  details.className = "yze-action-widget__reference";
  details.innerHTML = COMBAT_REFERENCE_HTML;
  details.open = Boolean(open);
  let lastOpen = details.open;
  details.addEventListener("toggle", () => {
    if (details.open === lastOpen) return;
    lastOpen = details.open;
    onToggle?.(details.open);
  });
  return details;
}
