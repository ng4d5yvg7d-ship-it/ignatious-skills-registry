// Ignatious Skill Roadmap — Dashboard
// Reads CSVs (live published Sheets URLs), renders org chart + grid.
// Branding follows the Ignatious brand guide (Arial, brand green #379E5C primary accent).

const CONFIG = {
  // -- LIVE: published-to-web CSV URLs from the Skills Registry Sheet.
  // The dashboard re-fetches these on every page load, so any Sheet edit shows
  // up by refreshing the dashboard.
  sources: {
    skills:        'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ4LwGRO02cvX4yx7rOrqrCZjGP8tmPTrHKSDs3wLoK_CaWXvuMJEltt2M4bkoe66IQVbbHgukihhI4/pub?gid=1103860495&single=true&output=csv',
    orchestrators: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ4LwGRO02cvX4yx7rOrqrCZjGP8tmPTrHKSDs3wLoK_CaWXvuMJEltt2M4bkoe66IQVbbHgukihhI4/pub?gid=1093244301&single=true&output=csv',
    people:        'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ4LwGRO02cvX4yx7rOrqrCZjGP8tmPTrHKSDs3wLoK_CaWXvuMJEltt2M4bkoe66IQVbbHgukihhI4/pub?gid=338204228&single=true&output=csv',
  },

  // -- DEV fallback (uncomment to read local CSV mirrors instead):
  // sources: {
  //   skills: './data/skills.csv',
  //   orchestrators: './data/orchestrators.csv',
  //   people: './data/people.csv',
  // },

  registryUrl: 'https://docs.google.com/spreadsheets/d/19l3xSQqP3YqPhpU1c_fqXmVvvDAfSyIfE0vr262eSys/edit',
};

// SINGLE SOURCE OF TRUTH for the canonical Status enum.
// Mirrors the Google Sheet's data validation list. The dropdown, legend, stats
// banner, and color styles all read from this — change once, propagate everywhere.
const CANONICAL_STATUSES = [
  { value: 'Not started', label: 'Not started', swatch: '#374151', card: 'bg-white/[.04] border-white/15',        badge: 'bg-white/10 text-gray-300 border border-white/20' },
  { value: 'In progress', label: 'In progress', swatch: '#7c2d12', card: 'bg-orange-950/40 border-orange-700/60', badge: 'bg-orange-500/15 text-orange-300 border border-orange-500/40' },
  { value: 'Built',       label: 'Built',       swatch: '#379E5C', card: 'bg-[#379E5C]/15 border-[#379E5C]/60',   badge: 'bg-[#379E5C]/20 text-[#9bd9b1] border border-[#379E5C]/50' },
];

const STATUS_BY_VALUE = Object.fromEntries(CANONICAL_STATUSES.map(s => [s.value, s]));

// Canonical category order — used to lay out the "By Category" view.
const CATEGORY_ORDER = [
  'Deal Execution & Process Management',
  'Financial Analysis',
  'Intelligence & Deal Origination',
  'Research & Company Intelligence',
  'Content & Deliverable Production',
  'Platform & Infrastructure',
];

// Org chart view: 'orchestrator' (columns = orchestrators) or 'category' (columns = categories).
let currentView = 'orchestrator';

// Required columns per tab. Extra columns tolerated; missing → fail loud.
const EXPECTED = {
  skills: ['ID', 'Name', 'Status', 'Primary Orchestrator', 'Category', 'Source'],
  orchestrators: ['Name', 'Display Order'],
  people: ['Name', 'Role'],
};

function getCol(row, name) {
  // Tolerant of multi-line headers (e.g. "Source\n(for reference)")
  const key = Object.keys(row).find(k => k.split(/\n|\r/)[0].trim() === name);
  return key ? (row[key] ?? '').toString().trim() : '';
}

// Tolerant score lookup — matches any column whose first-line header ends in
// "Score" (case-insensitive). Survives renames like "Priority Score" →
// "Assigned Score" → "Perceived Score" without code changes.
function getScore(row) {
  const key = Object.keys(row).find(k => /score\s*$/i.test(k.split(/\n|\r/)[0].trim()));
  return key ? (row[key] ?? '').toString().trim() : '';
}

// Compact orchestrator names so they fit on cards. Strips "Builder"/"Runner"
// suffixes and abbreviates a couple of long ones.
function abbrevOrch(name) {
  return name
    .replace(/\s+Builder$/i, '')
    .replace(/\s+Runner$/i, '')
    .replace(/Market Intelligence/i, 'Mkt Intel')
    .replace(/Management Presentation/i, 'Mgmt Presentation')
    .trim();
}

function validateSchema(rows, tabName) {
  if (!rows.length) throw new Error(`${tabName} CSV is empty`);
  const expected = EXPECTED[tabName];
  const headers = Object.keys(rows[0]).map(k => k.split(/\n|\r/)[0].trim());
  const missing = expected.filter(c => !headers.includes(c));
  if (missing.length) {
    throw new Error(
      `${tabName}: missing required column(s): ${missing.join(', ')}\n` +
      `Found columns: ${headers.join(', ')}`
    );
  }
}

async function fetchCsv(url) {
  // Cache-busting: append a unique query param + tell the browser not to
  // serve from its own cache. (Google's CDN still caches published-to-web
  // CSVs for 1–5 min; we can't bypass that — only wait it out.)
  const sep = url.includes('?') ? '&' : '?';
  const bustedUrl = `${url}${sep}_t=${Date.now()}`;
  const res = await fetch(bustedUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch ${url} → HTTP ${res.status}`);
  const text = await res.text();
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: r => resolve(r.data),
      error: reject,
    });
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// -- Renderers ----------------------------------------------------------------

function renderStatusFilter() {
  const sel = document.getElementById('filter-status');
  CANONICAL_STATUSES.forEach(s => {
    const opt = document.createElement('option');
    opt.textContent = s.label;
    sel.appendChild(opt);
  });
}

function renderLegend() {
  const html = CANONICAL_STATUSES.map(s => `
    <span class="flex items-center gap-1.5">
      <span class="w-2.5 h-2.5 rounded-sm" style="background-color: ${s.swatch};"></span>
      ${s.label}
    </span>
  `).join('') + `
    <span class="text-gray-700">·</span>
    <span>●N = N people interested</span>
  `;
  document.getElementById('legend').innerHTML = html;
}

function renderStats(skills) {
  const counts = Object.fromEntries(CANONICAL_STATUSES.map(s => [s.value, 0]));
  let interestedTotal = 0;
  let withInterested = 0;
  for (const s of skills) {
    const st = getCol(s, 'Status');
    if (counts[st] !== undefined) counts[st]++;
    const i = getCol(s, 'Interested');
    if (i) {
      const n = i.split(',').filter(x => x.trim()).length;
      interestedTotal += n;
      if (n) withInterested++;
    }
  }
  const total = skills.length;
  const pctBuilt = total ? Math.round((counts['Built'] / total) * 100) : 0;
  const pctActive = total ? Math.round(((counts['Built'] + counts['In progress']) / total) * 100) : 0;

  // Only show statuses present in the data (zero-count statuses hidden).
  const statusBreakdown = CANONICAL_STATUSES
    .filter(s => counts[s.value] > 0)
    .map(s => {
      const n = counts[s.value];
      const colorClass =
        s.value === 'Built'       ? 'text-ig-green' :
        s.value === 'In progress' ? 'text-orange-400' :
                                     'text-gray-400';
      return `<span class="text-sm ${colorClass} font-bold">${n} ${s.label.toLowerCase()}</span>`;
    })
    .join('<span class="text-gray-700">·</span>');

  document.getElementById('stats').innerHTML = `
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
      <span class="text-3xl font-bold tracking-tight">${total}</span>
      <span class="text-xs uppercase tracking-[0.18em] text-gray-400">total skills</span>
      <span class="text-gray-700 mx-1">·</span>
      ${statusBreakdown}
    </div>
    <div class="text-xs text-gray-500 mb-3">
      ${interestedTotal} ${interestedTotal === 1 ? 'person' : 'people'} on interested lists across
      ${withInterested} ${withInterested === 1 ? 'skill' : 'skills'}
    </div>
    <div class="flex items-center gap-3">
      <div class="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden flex">
        <div class="bg-ig-green h-1.5 transition-all" style="width: ${pctBuilt}%"></div>
        <div class="bg-orange-500 h-1.5 transition-all" style="width: ${Math.max(0, pctActive - pctBuilt)}%"></div>
      </div>
      <div class="text-[10px] text-gray-400 font-mono w-20 text-right uppercase tracking-wider">${pctBuilt}% built</div>
    </div>
  `;
}

function skillCardHtml(skill, subtextField = 'category') {
  const status = getCol(skill, 'Status') || 'Not started';
  const styles = STATUS_BY_VALUE[status] || STATUS_BY_VALUE['Not started'];
  const interested = getCol(skill, 'Interested');
  const intCount = interested.split(',').filter(x => x.trim()).length;
  const score = getScore(skill);
  const owner = getCol(skill, 'Owner');
  const desc = getCol(skill, 'Description');
  const subtext = subtextField === 'category'
    ? getCol(skill, 'Category')
    : getCol(skill, 'Primary Orchestrator');

  // Also Serves: secondary orchestrators this skill feeds. De-dupe primary out.
  const primary = getCol(skill, 'Primary Orchestrator');
  const alsoServes = getCol(skill, 'Also Serves')
    .split(',').map(x => x.trim()).filter(x => x && x !== primary);

  // Skill File Link: only render as clickable when the column holds a real URL.
  const fileLink = getCol(skill, 'Skill File Link');
  const isUrl = /^https?:\/\//i.test(fileLink);
  const nameHtml = isUrl
    ? `<a href="${escapeHtml(fileLink)}" target="_blank" rel="noopener" class="text-white hover:text-ig-green transition">${escapeHtml(getCol(skill, 'Name'))} <span class="text-[9px] opacity-60">↗</span></a>`
    : escapeHtml(getCol(skill, 'Name'));

  return `
    <div class="skill-card border ${styles.card} rounded p-2.5"
         title="${escapeHtml(desc)}">
      <div class="text-[12px] font-bold leading-snug text-white">${nameHtml}</div>

      <div class="mt-1.5 flex items-center justify-between gap-2 text-[10px] leading-tight">
        <span class="text-gray-300 truncate">${owner ? escapeHtml(owner) : '<span class="text-gray-500 italic">Partner TBD</span>'}</span>
        <span class="flex items-center gap-1.5 shrink-0 font-mono text-gray-500">
          ${score ? `<span>·${score}</span>` : ''}
          ${intCount ? `<span class="text-gray-300">●${intCount}</span>` : ''}
        </span>
      </div>

      ${alsoServes.length ? `
        <div class="mt-1.5 text-[10px] leading-tight truncate" style="color: #5fc77f;">
          <span class="text-gray-500 mr-1">↗ also:</span>${escapeHtml(alsoServes.map(abbrevOrch).join(', '))}
        </div>` : ''}

      ${subtext ? `<div class="mt-1 text-[9px] uppercase tracking-[0.1em] text-gray-500 truncate">${escapeHtml(subtext)}</div>` : ''}
    </div>
  `;
}

function columnHeader(label) {
  return `
    <div class="bg-black border border-ig-green/40 rounded px-3 py-2.5 text-center">
      <div class="text-[10px] uppercase tracking-[0.18em] text-ig-green font-bold leading-tight">${escapeHtml(label)}</div>
    </div>
  `;
}

function renderOrgChart(skills, orchestrators) {
  const orgEl = document.getElementById('orgchart');
  const platSection = document.getElementById('platform-section');

  if (currentView === 'orchestrator') {
    // Columns = orchestrators in display order; cards' subtext = category
    orgEl.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3';
    const sorted = [...orchestrators].sort((a, b) =>
      (parseInt(getCol(a, 'Display Order')) || 0) - (parseInt(getCol(b, 'Display Order')) || 0)
    );
    orgEl.innerHTML = sorted.map(orch => {
      const orchName = getCol(orch, 'Name');
      const inCol = skills
        .filter(s => getCol(s, 'Primary Orchestrator') === orchName)
        .sort((a, b) => (parseFloat(getScore(b)) || 0) - (parseFloat(getScore(a)) || 0));
      return `
        <div class="flex flex-col gap-2">
          ${columnHeader(orchName)}
          <div class="flex flex-col gap-1.5">
            ${inCol.length
              ? inCol.map(s => skillCardHtml(s, 'category')).join('')
              : '<div class="text-xs text-gray-700 text-center py-3">no skills yet</div>'}
          </div>
        </div>
      `;
    }).join('');

    // Platform section = skills with no Primary Orchestrator
    const platform = skills.filter(s => !getCol(s, 'Primary Orchestrator'));
    if (platform.length) {
      platSection.style.display = '';
      document.getElementById('platform').innerHTML = platform
        .sort((a, b) => (parseFloat(getScore(b)) || 0) - (parseFloat(getScore(a)) || 0))
        .map(s => skillCardHtml(s, 'category')).join('');
    } else {
      platSection.style.display = 'none';
    }

  } else {
    // Columns = categories; cards' subtext = primary orchestrator
    orgEl.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3';

    // Build the ordered list of categories actually present in the data, plus
    // any categories from CATEGORY_ORDER that have skills, plus any unexpected
    // categories at the end (so we never silently drop data).
    const presentCats = new Set(skills.map(s => getCol(s, 'Category')).filter(Boolean));
    const ordered = [
      ...CATEGORY_ORDER.filter(c => presentCats.has(c)),
      ...[...presentCats].filter(c => !CATEGORY_ORDER.includes(c)).sort(),
    ];
    // Skills with no category land in their own column
    const uncategorized = skills.filter(s => !getCol(s, 'Category'));

    orgEl.innerHTML = ordered.map(cat => {
      const inCol = skills
        .filter(s => getCol(s, 'Category') === cat)
        .sort((a, b) => (parseFloat(getScore(b)) || 0) - (parseFloat(getScore(a)) || 0));
      return `
        <div class="flex flex-col gap-2">
          ${columnHeader(cat)}
          <div class="flex flex-col gap-1.5">
            ${inCol.map(s => skillCardHtml(s, 'orchestrator')).join('')}
          </div>
        </div>
      `;
    }).join('') + (uncategorized.length ? `
      <div class="flex flex-col gap-2">
        ${columnHeader('Uncategorized')}
        <div class="flex flex-col gap-1.5">
          ${uncategorized.map(s => skillCardHtml(s, 'orchestrator')).join('')}
        </div>
      </div>` : '');

    // Hide the standalone Platform section in category view (those skills are
    // already in the Platform & Infrastructure column above).
    platSection.style.display = 'none';
  }
}

function setupViewToggle(skills, orchestrators) {
  const buttons = document.querySelectorAll('#view-toggle button');
  function activate(view) {
    currentView = view;
    buttons.forEach(b => {
      const active = b.dataset.view === view;
      b.classList.toggle('bg-ig-green', active);
      b.classList.toggle('text-white', active);
      b.classList.toggle('text-gray-400', !active);
    });
    renderOrgChart(skills, orchestrators);
  }
  buttons.forEach(b => b.addEventListener('click', () => activate(b.dataset.view)));
  activate('orchestrator');
}

function renderGrid(skills) {
  const sorted = [...skills].sort((a, b) =>
    (parseFloat(getScore(b)) || 0) - (parseFloat(getScore(a)) || 0)
  );
  document.getElementById('grid-rows').innerHTML = sorted.map(s => {
    const status = getCol(s, 'Status') || 'Not started';
    const styles = STATUS_BY_VALUE[status] || STATUS_BY_VALUE['Not started'];
    const interested = getCol(s, 'Interested');
    const intList = interested.split(',').map(x => x.trim()).filter(Boolean);
    const score = getScore(s);
    const owner = getCol(s, 'Owner');
    const category = getCol(s, 'Category');
    const fileLink = getCol(s, 'Skill File Link');
    const isUrl = /^https?:\/\//i.test(fileLink);
    const tableNameHtml = isUrl
      ? `<a href="${escapeHtml(fileLink)}" target="_blank" rel="noopener" class="hover:text-ig-green transition">${escapeHtml(getCol(s, 'Name'))} <span class="text-[9px] opacity-60">↗</span></a>`
      : escapeHtml(getCol(s, 'Name'));
    return `
      <tr class="border-t border-white/5 hover:bg-white/[.03]"
          data-name="${escapeHtml(getCol(s, 'Name')).toLowerCase()}"
          data-status="${escapeHtml(status)}"
          data-owner="${owner ? escapeHtml(owner) : '__unowned__'}"
          data-orchestrator="${escapeHtml(getCol(s, 'Primary Orchestrator'))}"
          data-category="${escapeHtml(category)}"
          data-score="${score || ''}">
        <td class="px-3 py-2 font-bold">${tableNameHtml}</td>
        <td class="px-3 py-2"><span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${styles.badge}">${status}</span></td>
        <td class="px-3 py-2 text-gray-300">${owner ? escapeHtml(owner) : '<span class="text-gray-500 italic">Partner TBD</span>'}</td>
        <td class="px-3 py-2 text-gray-400 text-xs">${escapeHtml(category) || '<span class="text-gray-600">—</span>'}</td>
        <td class="px-3 py-2 text-gray-300 text-right font-mono">${score || '<span class="text-gray-600">—</span>'}</td>
        <td class="px-3 py-2 text-gray-400">${escapeHtml(getCol(s, 'Primary Orchestrator')) || '<span class="text-gray-600">—</span>'}</td>
        <td class="px-3 py-2 text-gray-400 text-xs">${intList.length ? `●${intList.length} <span class="text-gray-500">${escapeHtml(intList.join(', '))}</span>` : '<span class="text-gray-600">—</span>'}</td>
      </tr>
    `;
  }).join('');
}

function setupFilters() {
  const search   = document.getElementById('search');
  const fStatus  = document.getElementById('filter-status');
  const fOwner   = document.getElementById('filter-owner');
  const fCat     = document.getElementById('filter-category');
  const fScore   = document.getElementById('filter-score');
  const fOrch    = document.getElementById('filter-orchestrator');
  const countEl  = document.getElementById('grid-count');
  const rows = () => document.querySelectorAll('#grid-rows tr');

  function apply() {
    const q  = search.value.toLowerCase().trim();
    const st = fStatus.value;
    const ow = fOwner.value;
    const ca = fCat.value;
    const sc = fScore.value;
    const or = fOrch.value;
    let visible = 0;
    rows().forEach(row => {
      const ok =
        (!q  || row.dataset.name.includes(q)) &&
        (!st || row.dataset.status === st) &&
        (!ow || row.dataset.owner === ow) &&
        (!ca || row.dataset.category === ca) &&
        (!sc || row.dataset.score === sc) &&
        (!or || row.dataset.orchestrator === or);
      row.style.display = ok ? '' : 'none';
      if (ok) visible++;
    });
    const total = rows().length;
    countEl.textContent = visible === total ? `${total} skills` : `${visible} of ${total} skills`;
  }

  [search, fStatus, fOwner, fCat, fScore, fOrch].forEach(el => {
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
  });
  apply();
}

// -- Main ---------------------------------------------------------------------

async function main() {
  try {
    const [skills, orchestrators, people] = await Promise.all([
      fetchCsv(CONFIG.sources.skills),
      fetchCsv(CONFIG.sources.orchestrators),
      fetchCsv(CONFIG.sources.people),
    ]);

    validateSchema(skills, 'skills');
    validateSchema(orchestrators, 'orchestrators');
    validateSchema(people, 'people');

    renderStatusFilter();
    renderLegend();

    document.getElementById('filter-orchestrator').insertAdjacentHTML(
      'beforeend',
      orchestrators.map(o => `<option>${escapeHtml(getCol(o, 'Name'))}</option>`).join('')
    );
    const cats = [...new Set(skills.map(s => getCol(s, 'Category')).filter(Boolean))].sort();
    document.getElementById('filter-category').insertAdjacentHTML(
      'beforeend',
      cats.map(c => `<option>${escapeHtml(c)}</option>`).join('')
    );

    // Owner dropdown — named owners alphabetically, then "Partner TBD" if any blanks exist.
    const owners = [...new Set(skills.map(s => getCol(s, 'Owner')).filter(Boolean))].sort();
    const hasUnowned = skills.some(s => !getCol(s, 'Owner'));
    document.getElementById('filter-owner').insertAdjacentHTML(
      'beforeend',
      owners.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('') +
      (hasUnowned ? `<option value="__unowned__">Partner TBD</option>` : '')
    );

    // Score dropdown — distinct scores present in the data, descending.
    const scores = [...new Set(skills.map(s => getScore(s)).filter(Boolean))]
      .map(Number).sort((a, b) => b - a);
    document.getElementById('filter-score').insertAdjacentHTML(
      'beforeend',
      scores.map(s => `<option>${s}</option>`).join('')
    );

    renderStats(skills);
    renderGrid(skills);
    setupViewToggle(skills, orchestrators);  // also performs the initial org chart render
    setupFilters();

    document.getElementById('open-registry').href = CONFIG.registryUrl;

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  } catch (e) {
    console.error(e);
    document.getElementById('loading').classList.add('hidden');
    const err = document.getElementById('error');
    err.classList.remove('hidden');
    err.classList.add('flex');
    document.getElementById('error-text').textContent = e.message;
  }
}

main();
