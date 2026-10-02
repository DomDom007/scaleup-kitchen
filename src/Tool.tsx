// Scaleup Kitchen: scales recipes to any number of covers, builds one shopping list, and plans prep by station back from service.
import { useState } from "react";
import { toCsv } from "./lib/csv";
import { download, uid, useStored } from "./lib/store";
import { hhmm, toHours } from "./lib/time";
import { Section, Stat, Stats } from "./ui/kit";

const T = "scaleup-kitchen";
type Ing = { name: string; qty: number; unit: string };
type Step = { what: string; mins: number; before: number; station: string }; // before = hours before service it must be done
type Recipe = { id: string; name: string; yields: number; ings: Ing[]; steps: Step[] };
const SAMPLE: Recipe[] = [
  { id: "r1", name: "Lamb couscous", yields: 10, ings: [{ name: "Lamb shoulder", qty: 2.2, unit: "kg" }, { name: "Couscous (medium)", qty: 1, unit: "kg" }, { name: "Carrots", qty: 800, unit: "g" }, { name: "Courgettes", qty: 700, unit: "g" }, { name: "Chickpeas (cooked)", qty: 500, unit: "g" }, { name: "Tomato paste", qty: 120, unit: "g" }, { name: "Onions", qty: 600, unit: "g" }, { name: "Olive oil", qty: 150, unit: "ml" }],
    steps: [{ what: "Brown lamb and start the broth", mins: 45, before: 4, station: "Hot" }, { what: "Prep vegetables", mins: 40, before: 3.5, station: "Prep" }, { what: "Steam couscous (3 times)", mins: 60, before: 1.5, station: "Hot" }] },
  { id: "r2", name: "Mechouia salad", yields: 12, ings: [{ name: "Peppers", qty: 1.5, unit: "kg" }, { name: "Tomatoes", qty: 1, unit: "kg" }, { name: "Garlic", qty: 60, unit: "g" }, { name: "Olive oil", qty: 200, unit: "ml" }, { name: "Tuna (tins)", qty: 4, unit: "pcs" }, { name: "Eggs", qty: 6, unit: "pcs" }],
    steps: [{ what: "Grill and peel peppers and tomatoes", mins: 50, before: 5, station: "Grill" }, { what: "Chop, season, chill", mins: 25, before: 3, station: "Cold" }] },
  { id: "r3", name: "Orange blossom cream", yields: 8, ings: [{ name: "Milk", qty: 1, unit: "L" }, { name: "Cream", qty: 500, unit: "ml" }, { name: "Sugar", qty: 180, unit: "g" }, { name: "Cornflour", qty: 90, unit: "g" }, { name: "Orange blossom water", qty: 40, unit: "ml" }, { name: "Pistachios", qty: 120, unit: "g" }],
    steps: [{ what: "Cook cream and set in pots", mins: 40, before: 6, station: "Pastry" }, { what: "Chop pistachios, garnish", mins: 20, before: 1, station: "Pastry" }] },
];
// Normalise to a base unit so different recipes can be added up.
const BASE: Record<string, [string, number]> = { g: ["g", 1], kg: ["g", 1000], mg: ["g", 0.001], ml: ["ml", 1], l: ["ml", 1000], cl: ["ml", 10], pcs: ["pcs", 1], pc: ["pcs", 1], tbsp: ["ml", 15], tsp: ["ml", 5], cup: ["ml", 240], bunch: ["bunch", 1] };
const pretty = (v: number, base: string) => base === "g" && v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kg` : base === "ml" && v >= 1000 ? `${(v / 1000).toFixed(2)} L` : base === "pcs" ? `${Math.ceil(v)} pcs` : `${Math.round(v)} ${base}`;

export default function ScaleupKitchen() {
  const [recipes, setRecipes] = useStored<Recipe[]>(T, "recipes", SAMPLE);
  const [ev, setEv] = useStored(T, "event", { name: "Wedding lunch, Hammamet", covers: 180, service: "13:30", buffer: 10 });
  const [menu, setMenu] = useStored<Record<string, number>>(T, "menu", { r1: 1, r2: 1, r3: 1 });
  const [edit, setEdit] = useState<string | null>(null);
  const factor = (r: Recipe) => ((menu[r.id] ?? 0) * ev.covers * (1 + ev.buffer / 100)) / r.yields;
  const onMenu = recipes.filter(r => (menu[r.id] ?? 0) > 0);
  const shopping = Object.values(onMenu.flatMap(r => r.ings.map(i => ({ ...i, q: i.qty * factor(r), recipe: r.name }))).reduce((acc, i) => {
    const [base, mult] = BASE[i.unit.toLowerCase()] ?? [i.unit, 1];
    const k = i.name.toLowerCase() + "|" + base;
    acc[k] = { name: i.name, base, total: (acc[k]?.total ?? 0) + i.q * mult, uses: [...new Set([...(acc[k]?.uses ?? []), i.recipe])] };
    return acc;
  }, {} as Record<string, { name: string; base: string; total: number; uses: string[] }>)).sort((a, b) => a.name.localeCompare(b.name));
  // Bigger batches take longer: prep time grows with the square root of the batch multiplier (cooks work in parallel).
  const tasks = onMenu.flatMap(r => r.steps.map(s => ({ ...s, recipe: r.name, mins: Math.round(s.mins * Math.max(1, Math.sqrt(factor(r)))) }))).map(t => ({ ...t, end: toHours(ev.service) - t.before, start: toHours(ev.service) - t.before - t.mins / 60 })).sort((a, b) => a.start - b.start);
  const stations = [...new Set(tasks.map(t => t.station))];
  const first = Math.min(...tasks.map(t => t.start), toHours(ev.service) - 1), span = toHours(ev.service) - first;
  const r = recipes.find(x => x.id === edit);

  return (
    <div className="stack">
      <Section title={ev.name} aside={<><button className="btn small primary" onClick={() => download("shopping-list.csv", toCsv([["Ingredient", "Quantity", "Unit", "Used in"], ...shopping.map(s => [s.name, s.base === "pcs" ? Math.ceil(s.total) : Math.round(s.total), s.base, s.uses.join("; ")])]), "text/csv")}>Shopping list CSV</button><button className="btn small" onClick={() => window.print()}>Print</button></>}>
        <Stats><Stat value={ev.covers} label="Covers" /><Stat value={onMenu.length} label="Dishes" /><Stat value={`${Math.round(tasks.reduce((a, t) => a + t.mins, 0) / 60)} h`} label="Prep work" /><Stat value={hhmm(first)} label="First task starts" tone="warn" /></Stats>
        <div className="row" style={{ marginTop: 14 }}>
          <label className="field"><span>Event</span><input className="input" value={ev.name} onChange={e => setEv({ ...ev, name: e.target.value })} /></label>
          <label className="field" style={{ flex: "0 0 100px" }}><span>Covers</span><input id="sk-cov" className="input num" value={ev.covers} onChange={e => setEv({ ...ev, covers: parseInt(e.target.value) || 0 })} /></label>
          <label className="field" style={{ flex: "0 0 130px" }}><span>Service at</span><input type="time" className="input" value={ev.service} onChange={e => setEv({ ...ev, service: e.target.value })} /></label>
          <label className="field" style={{ flex: "0 0 120px" }}><span>Extra buffer %</span><input className="input num" value={ev.buffer} onChange={e => setEv({ ...ev, buffer: parseFloat(e.target.value) || 0 })} /></label>
        </div>
      </Section>
      <Section title="Menu">
        {recipes.map(x => <div key={x.id} className="row" style={{ alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line)" }}><strong style={{ flex: 1 }}>{x.name} <span className="note">recipe makes {x.yields}</span></strong>
          <label className="field" style={{ flex: "0 0 150px" }}><span>Portions per guest</span><select className="input" value={menu[x.id] ?? 0} onChange={e => setMenu({ ...menu, [x.id]: +e.target.value })}>{[0, 0.25, 0.5, 0.75, 1, 1.5].map(v => <option key={v} value={v}>{v === 0 ? "Not on menu" : v}</option>)}</select></label>
          <span className="note" style={{ width: 110 }}>{(menu[x.id] ?? 0) > 0 ? `×${factor(x).toFixed(1)} batch` : ""}</span><button className="btn ghost small" onClick={() => setEdit(edit === x.id ? null : x.id)}>Edit recipe</button></div>)}
        <button className="btn small" style={{ marginTop: 10 }} onClick={() => { const n = { id: uid(), name: "New recipe", yields: 10, ings: [], steps: [] }; setRecipes([...recipes, n]); setEdit(n.id); }}>Add a recipe</button>
      </Section>
      {r && <Section title={`Recipe: ${r.name}`} aside={<button className="btn ghost small danger" onClick={() => { setRecipes(recipes.filter(x => x.id !== r.id)); setEdit(null); }}>Delete recipe</button>}>
        <div className="row"><label className="field"><span>Name</span><input className="input" value={r.name} onChange={e => setRecipes(recipes.map(x => x.id === r.id ? { ...x, name: e.target.value } : x))} /></label><label className="field" style={{ flex: "0 0 110px" }}><span>Portions</span><input className="input num" value={r.yields} onChange={e => setRecipes(recipes.map(x => x.id === r.id ? { ...x, yields: parseInt(e.target.value) || 1 } : x))} /></label></div>
        <label className="field" style={{ marginTop: 10 }}><span>Ingredients, one per line: quantity unit name (e.g. 800 g carrots)</span><textarea className="input" rows={6} style={{ fontFamily: "var(--mono)", fontSize: 13 }} defaultValue={r.ings.map(i => `${i.qty} ${i.unit} ${i.name}`).join("\n")} onBlur={e => setRecipes(recipes.map(x => x.id === r.id ? { ...x, ings: e.target.value.split("\n").map(l => l.trim().match(/^([\d.,]+)\s*([a-zA-Z]+)\s+(.+)$/)).filter(Boolean).map(m => ({ qty: parseFloat(m![1].replace(",", ".")), unit: m![2], name: m![3] })) } : x))} /></label>
        <label className="field" style={{ marginTop: 10 }}><span>Prep steps, one per line: minutes | hours before service | station | what</span><textarea className="input" rows={4} style={{ fontFamily: "var(--mono)", fontSize: 13 }} defaultValue={r.steps.map(s => `${s.mins} | ${s.before} | ${s.station} | ${s.what}`).join("\n")} onBlur={e => setRecipes(recipes.map(x => x.id === r.id ? { ...x, steps: e.target.value.split("\n").map(l => l.split("|").map(p => p.trim())).filter(p => p.length === 4).map(p => ({ mins: parseFloat(p[0]) || 0, before: parseFloat(p[1]) || 0, station: p[2], what: p[3] })) } : x))} /></label>
      </Section>}
      <div className="grid2">
        <Section title="Shopping list">
          <div className="table-wrap"><table className="t"><tbody>{shopping.map(s => <tr key={s.name + s.base}><td>{s.name}<br /><span className="note">{s.uses.join(", ")}</span></td><td className="r"><strong>{pretty(s.total, s.base)}</strong></td></tr>)}</tbody></table></div>
        </Section>
        <Section title="Scaled recipes">
          {onMenu.map(x => <div key={x.id} style={{ marginBottom: 12 }}><strong>{x.name} <span className="note">for {Math.round(factor(x) * x.yields)} portions</span></strong><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{x.ings.map(i => { const [b, m] = BASE[i.unit.toLowerCase()] ?? [i.unit, 1]; return <li key={i.name}>{pretty(i.qty * factor(x) * m, b)} {i.name.toLowerCase()}</li>; })}</ul></div>)}
        </Section>
      </div>
      <Section title={`Prep timeline to ${ev.service} service`}>
        <div className="sk-gantt">{stations.map(st => <div key={st} className="sk-lane"><span className="sk-st">{st}</span><div className="sk-track">{tasks.filter(t => t.station === st).map((t, i) => <b key={i} title={`${t.recipe}: ${t.what}, ${hhmm(t.start)} to ${hhmm(t.end)}`} style={{ left: `${((t.start - first) / span) * 100}%`, width: `${((t.end - t.start) / span) * 100}%` }}>{t.recipe.split(" ")[0]}</b>)}</div></div>)}</div>
        <ol className="sk-list">{tasks.map((t, i) => <li key={i}><span className="num">{hhmm(t.start)} to {hhmm(t.end)}</span><span className="pill">{t.station}</span>{t.recipe}: {t.what} ({t.mins} min)</li>)}</ol>
      </Section>
      <style>{`.sk-gantt{display:grid;gap:6px}.sk-lane{display:grid;grid-template-columns:70px 1fr;gap:8px;align-items:center}.sk-st{font-family:var(--mono);font-size:12px;color:var(--muted)}.sk-track{position:relative;height:28px;background:var(--sunk);border-radius:6px}.sk-track b{position:absolute;top:3px;bottom:3px;background:var(--accent);color:var(--accent-ink);border-radius:4px;font-size:11px;padding:0 4px;overflow:hidden;white-space:nowrap;display:flex;align-items:center}
      .sk-list{margin:14px 0 0;padding-left:18px;display:grid;gap:4px}.sk-list li span{margin-right:8px}.sk-list .num{font-family:var(--mono);font-size:13px}`}</style>
    </div>
  );
}
