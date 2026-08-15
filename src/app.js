import './styles.css';
import {
  isConfigured,
  supabase,
  signUp,
  signIn,
  signOut,
  getSession,
  getProfile,
  getWomanData,
  getPartnerData,
  saveCycleSettings,
  addPeriod,
  updatePeriod,
  deletePeriod,
  createPairCode,
  claimPairCode,
  revokePartnership
} from './supabase.js';
import {
  toISODate,
  parseDate,
  addDays,
  estimatedCycleLength,
  getNextPeriod,
  getIrregularities,
  resolveCycleMode,
  monthCells,
  yearMonths,
  formatDateEs,
  periodDuration
} from './cycle-engine.mjs';
import { isNativeAndroid, updateAndroidWidget, requestPinAndroidWidget } from './widget.js';

const root = document.querySelector('#app');
const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const weekdays = ['L','M','X','J','V','S','D'];

const state = {
  session: null,
  profile: null,
  settings: null,
  periods: [],
  partnership: null,
  partnerProfile: null,
  view: 'home',
  authMode: 'login',
  authRole: 'woman',
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear(),
  yearView: new Date().getFullYear(),
  loading: false,
  message: null,
  modal: null,
  pairCode: null
};

boot();

document.addEventListener('click', handleClick);
document.addEventListener('submit', handleSubmit);

async function boot() {
  registerServiceWorker();
  if (!isConfigured) {
    render();
    return;
  }
  const { data } = await getSession();
  state.session = data.session;
  if (state.session) await loadData();
  render();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    if (session) await loadData();
    else resetPrivateState();
    render();
  });
}

async function loadData() {
  if (!state.session?.user) return;
  state.loading = true;
  try {
    const profileResult = await getProfile(state.session.user.id);
    if (profileResult.error) throw profileResult.error;
    state.profile = profileResult.data;

    if (state.profile.role === 'woman') {
      const { settingsResult, periodsResult, partnershipResult } = await getWomanData(state.profile.id);
      if (settingsResult.error) throw settingsResult.error;
      if (periodsResult.error) throw periodsResult.error;
      state.settings = settingsResult.data;
      state.periods = periodsResult.data || [];
      state.partnership = partnershipResult.data || null;
      state.partnerProfile = null;
    } else {
      const result = await getPartnerData(state.profile.id);
      if (result.partnership?.error) throw result.partnership.error;
      state.partnership = result.partnership?.data || null;
      if (state.partnership) {
        if (result.profile.error) throw result.profile.error;
        if (result.settings.error) throw result.settings.error;
        if (result.periods.error) throw result.periods.error;
        state.partnerProfile = result.profile.data;
        state.settings = result.settings.data;
        state.periods = result.periods.data || [];
      } else {
        state.partnerProfile = null;
        state.settings = null;
        state.periods = [];
      }
    }
    await syncWidget();
  } catch (error) {
    console.error(error);
    state.message = { type: 'error', text: friendlyError(error) };
  } finally {
    state.loading = false;
  }
}

function resetPrivateState() {
  state.profile = null;
  state.settings = null;
  state.periods = [];
  state.partnership = null;
  state.partnerProfile = null;
  state.pairCode = null;
  state.view = 'home';
}

function render() {
  if (!isConfigured) return renderSetup();
  if (!state.session) return renderAuth();
  if (!state.profile) return renderLoading();
  if (state.profile.role === 'man' && !state.partnership) return renderUnpairedMan();

  const role = state.profile.role;
  const content = role === 'woman' ? renderWomanView() : renderManView();
  root.innerHTML = `
    <main class="shell">
      <div class="container">
        ${renderTopbar()}
        ${renderMessage()}
        ${state.loading ? '<div class="notice">Actualizando información…</div>' : ''}
        ${content}
      </div>
    </main>
    ${renderNav(role)}
    ${renderModal()}
  `;
}

function renderSetup() {
  root.innerHTML = `
    <main class="shell">
      <section class="card setup">
        <div class="brand"><div class="brand-mark">E</div><div><div class="brand-name">Enma</div><div class="brand-sub">Configuración inicial</div></div></div>
        <h2 style="margin-top:28px">Conecta la base de datos segura</h2>
        <p>El código de Enma está listo, pero para crear cuentas y sincronizar una pareja necesita un proyecto Supabase propio.</p>
        <div class="notice">
          1. Crea un proyecto en Supabase.<br>
          2. Ejecuta <code>supabase/schema.sql</code> en el SQL Editor.<br>
          3. Define <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> en GitHub Actions o en tu archivo <code>.env</code>.<br>
          4. Vuelve a compilar la web/APK.
        </div>
        <p class="small muted" style="margin-top:16px">La clave anon de Supabase está diseñada para usarse en clientes; la protección real de los datos se aplica con Row Level Security incluida en este proyecto.</p>
      </section>
    </main>`;
}

function renderLoading() {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="auth-brand"><div class="brand-mark">E</div><div class="brand-name">Enma</div></div><div class="notice">Cargando tu espacio…</div></div></div>`;
}

function renderAuth() {
  const signup = state.authMode === 'signup';
  root.innerHTML = `
    <main class="auth-wrap">
      <section class="auth-card">
        <div class="auth-brand"><div class="brand-mark">E</div><div class="brand-name">Enma</div><p class="muted small">Tu ciclo, más claro. A tu ritmo.</p></div>
        <div class="auth-tabs">
          <button data-action="auth-mode" data-mode="login" class="${!signup ? 'active' : ''}">Entrar</button>
          <button data-action="auth-mode" data-mode="signup" class="${signup ? 'active' : ''}">Crear cuenta</button>
        </div>
        ${renderMessage()}
        <form data-form="auth">
          ${signup ? `
            <div class="field"><label>Nombre</label><input name="fullName" autocomplete="name" required maxlength="60" placeholder="Tu nombre" /></div>
            <div class="field"><label>Tipo de usuario</label></div>
            <div class="role-cards">
              <button type="button" class="role-card ${state.authRole === 'woman' ? 'active' : ''}" data-action="role" data-role="woman"><strong>Mujer</strong><span>Control completo del ciclo</span></button>
              <button type="button" class="role-card ${state.authRole === 'man' ? 'active' : ''}" data-action="role" data-role="man"><strong>Hombre</strong><span>Vista de pareja autorizada</span></button>
            </div>` : ''}
          <div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required placeholder="nombre@correo.com" /></div>
          <div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required placeholder="Mínimo 8 caracteres" /></div>
          <button class="primary-btn" type="submit">${signup ? 'Crear mi cuenta' : 'Entrar en Enma'}</button>
        </form>
        <p class="small muted" style="margin-top:16px">Las fechas de Enma son estimaciones basadas en los registros introducidos. No deben usarse como método anticonceptivo ni como diagnóstico médico.</p>
      </section>
    </main>`;
}

function renderTopbar() {
  const name = state.profile?.full_name || '';
  return `
    <header class="topbar">
      <div class="brand"><div class="brand-mark">E</div><div><div class="brand-name">Enma</div><div class="brand-sub">${escapeHtml(name)}</div></div></div>
      <button class="ghost-btn" data-action="logout">Salir</button>
    </header>`;
}

function renderNav(role) {
  const items = role === 'woman'
    ? [['home','Inicio'],['calendar','Calendario'],['record','Registrar'],['profile','Perfil']]
    : [['home','Resumen'],['calendar','Calendario'],['profile','Pareja']];
  return `<nav class="nav" style="grid-template-columns:repeat(${items.length},1fr)">${items.map(([key,label]) => `<button class="${state.view === key ? 'active' : ''}" data-action="view" data-view="${key}">${label}</button>`).join('')}</nav>`;
}

function renderWomanView() {
  if (state.view === 'calendar') return renderCalendarPage(false);
  if (state.view === 'record') return renderRecordPage();
  if (state.view === 'profile') return renderWomanProfile();
  return renderDashboard(false);
}

function renderManView() {
  if (state.view === 'calendar') return renderCalendarPage(true);
  if (state.view === 'profile') return renderManProfile();
  return renderDashboard(true);
}

function renderDashboard(partnerMode) {
  const next = getNextPeriod(state.periods, state.settings || {});
  const mode = resolveCycleMode(state.periods, state.settings || {});
  const avg = estimatedCycleLength(state.periods, state.settings?.default_cycle_length || 28);
  const irregularities = getIrregularities(state.periods, state.settings || {});
  const titleName = partnerMode ? state.partnerProfile?.full_name || 'tu pareja' : state.profile.full_name;
  const countdownText = next ? (next.daysRemaining >= 0 ? `${next.daysRemaining}` : `${next.overdueDays}`) : '—';
  const countdownLabel = !next ? 'Sin datos' : next.daysRemaining > 1 ? 'días' : next.daysRemaining === 1 ? 'día' : next.daysRemaining === 0 ? 'hoy' : next.overdueDays === 1 ? 'día sobre la estimación' : 'días sobre la estimación';

  return `
    <section class="grid two">
      <article class="card hero">
        <div>
          <div class="eyebrow">${partnerMode ? `Ciclo de ${escapeHtml(titleName)}` : 'Próxima regla estimada'}</div>
          <div class="countdown">${countdownText} <small>${countdownLabel}</small></div>
          <div class="hero-date">${next ? `Fecha estimada: ${formatDateEs(next.date)}` : 'Registra al menos un periodo para empezar a estimar.'}</div>
        </div>
        <div class="hero-row">
          <span class="pill">Ciclo: ${modeLabel(mode)}</span>
          <span class="pill">Media: ${avg} días</span>
          ${partnerMode && isNativeAndroid() ? '<button class="pill" style="border:0;color:#fff" data-action="pin-widget">＋ Widget</button>' : ''}
          ${!partnerMode ? '<button class="pill" style="border:0;color:#fff" data-action="open-period">＋ Registrar periodo</button>' : ''}
        </div>
      </article>
      <article class="card">
        <div class="eyebrow" style="color:var(--muted)">Resumen</div>
        <div class="grid three" style="margin-top:18px">
          <div class="metric"><strong>${avg}</strong><span>días de ciclo estimado</span></div>
          <div class="metric"><strong>${state.settings?.typical_period_days || 5}</strong><span>días de periodo configurados</span></div>
          <div class="metric"><strong>${state.periods.length}</strong><span>periodos registrados</span></div>
        </div>
        <div class="notice" style="margin-top:20px">Enma aprende de los últimos ciclos registrados. Cuantos más datos haya, más personalizada será la estimación.</div>
      </article>
    </section>

    <div class="section-title"><div><h2>Este mes</h2><p>Registrado y estimado</p></div><button class="ghost-btn" data-action="view" data-view="calendar">Ver año</button></div>
    <section class="grid two">
      ${renderMonthCard(new Date().getFullYear(), new Date().getMonth())}
      <article class="card">
        <h3>Irregularidades y cambios</h3>
        ${irregularities.length ? `<div class="list">${irregularities.map(i => `<div class="notice ${i.severity === 'attention' ? 'attention' : ''}">${escapeHtml(i.message)}</div>`).join('')}</div>` : '<div class="empty">No hay variaciones destacadas según tus registros recientes.</div>'}
        <p class="small muted" style="margin:14px 0 0">Estas alertas comparan tus propios registros y no sustituyen una valoración sanitaria.</p>
      </article>
    </section>`;
}

function renderCalendarPage(partnerMode) {
  const label = partnerMode ? `Calendario de ${escapeHtml(state.partnerProfile?.full_name || 'tu pareja')}` : 'Tu calendario';
  const months = yearMonths(state.yearView, state.periods, state.settings || {});
  return `
    <div class="section-title"><div><h2>${label}</h2><p>Periodos registrados y previsiones</p></div>
      <div class="actions"><button class="icon-btn" data-action="year-prev">←</button><button class="ghost-btn">${state.yearView}</button><button class="icon-btn" data-action="year-next">→</button></div>
    </div>
    <article class="card">
      <div class="year-grid">
        ${months.map(({ month, cells }) => renderMiniMonth(state.yearView, month, cells)).join('')}
      </div>
      <div class="legend"><span><i style="background:var(--period)"></i>Registrado</span><span><i style="background:var(--predicted)"></i>Estimado</span></div>
      <p class="small muted" style="margin-bottom:0">Las fechas futuras se recalculan cuando se añade un nuevo periodo.</p>
    </article>
    <div class="section-title"><div><h2>Detalle mensual</h2></div><div class="actions"><button class="icon-btn" data-action="month-prev">←</button><button class="ghost-btn">${monthNames[state.calendarMonth]} ${state.calendarYear}</button><button class="icon-btn" data-action="month-next">→</button></div></div>
    ${renderMonthCard(state.calendarYear, state.calendarMonth)}`;
}

function renderRecordPage() {
  const sorted = [...state.periods].sort((a,b) => b.start_date.localeCompare(a.start_date));
  return `
    <div class="section-title"><div><h2>Registrar periodo</h2><p>Añade el inicio y final de cada menstruación</p></div></div>
    <section class="grid two">
      <article class="card">
        <form data-form="period" class="form-grid">
          <div class="field"><label>Primer día</label><input type="date" name="startDate" value="${toISODate(new Date())}" required /></div>
          <div class="field"><label>Último día</label><input type="date" name="endDate" value="${toISODate(addDays(new Date(), (state.settings?.typical_period_days || 5) - 1))}" required /></div>
          <div class="field full"><button class="primary-btn" type="submit">Guardar periodo</button></div>
        </form>
        <div class="notice" style="margin-top:16px">Puedes ajustar en Perfil cuántos días suele durar tu periodo. Ese dato se utiliza para dibujar las previsiones futuras.</div>
      </article>
      <article class="card">
        <h3>Historial</h3>
        ${sorted.length ? `<div class="list">${sorted.map(p => `<div class="list-item"><div class="meta"><strong>${formatDateEs(p.start_date,{short:true})} – ${formatDateEs(p.end_date || p.start_date,{short:true})}</strong><span>${periodDuration(p)} días</span></div><div class="actions"><button class="ghost-btn" data-action="edit-period" data-id="${p.id}">Editar</button><button class="danger-btn" data-action="delete-period" data-id="${p.id}">Eliminar</button></div></div>`).join('')}</div>` : '<div class="empty">Todavía no has registrado periodos.</div>'}
      </article>
    </section>`;
}

function renderWomanProfile() {
  return `
    <div class="section-title"><div><h2>Ajustes del ciclo</h2><p>Personaliza Enma a tu ciclo</p></div></div>
    <section class="grid two">
      <article class="card">
        <form data-form="settings" class="form-grid">
          <div class="field"><label>Días habituales de periodo</label><input type="number" name="typicalPeriodDays" min="1" max="15" value="${state.settings?.typical_period_days || 5}" required /></div>
          <div class="field"><label>Duración inicial del ciclo</label><input type="number" name="cycleLength" min="15" max="60" value="${state.settings?.default_cycle_length || 28}" required /></div>
          <div class="field full"><label>Control de regularidad</label><select name="cycleMode"><option value="auto" ${state.settings?.cycle_mode === 'auto' ? 'selected' : ''}>Automático según mis registros</option><option value="regular" ${state.settings?.cycle_mode === 'regular' ? 'selected' : ''}>Regular</option><option value="irregular" ${state.settings?.cycle_mode === 'irregular' ? 'selected' : ''}>Irregular</option></select></div>
          <div class="field full"><button class="primary-btn" type="submit">Guardar ajustes</button></div>
        </form>
        <p class="small muted" style="margin-bottom:0">La duración inicial solo se usa cuando todavía no hay suficientes periodos para calcular una media propia.</p>
      </article>
      <article class="card">
        <h3>Pareja</h3>
        ${state.partnership ? `<div class="notice">Tienes una pareja vinculada. Puede consultar el ciclo en modo lectura, pero no puede crear, editar ni eliminar tus registros.</div><div class="actions" style="margin-top:14px"><button class="danger-btn" data-action="unlink">Desvincular pareja</button></div>` : `
          <p class="muted small">Genera un código temporal y compártelo únicamente con la persona que quieras vincular.</p>
          ${state.pairCode ? `<div class="code-box">${state.pairCode}</div><p class="small muted">Caduca en 24 horas y solo puede utilizarse una vez.</p>` : '<div class="empty">Aún no has generado un código.</div>'}
          <button class="primary-btn" data-action="create-pair-code">Generar código de pareja</button>`}
      </article>
    </section>
    <div class="section-title"><div><h2>Privacidad</h2></div></div>
    <article class="card"><div class="notice">El acceso de pareja es revocable. En la base de datos, el usuario hombre solo tiene permiso de lectura sobre el perfil, ajustes y periodos de la mujer con la que esté vinculado.</div></article>`;
}

function renderManProfile() {
  return `
    <div class="section-title"><div><h2>Pareja vinculada</h2><p>Acceso de solo lectura</p></div></div>
    <section class="grid two">
      <article class="card"><h3>${escapeHtml(state.partnerProfile?.full_name || 'Pareja')}</h3><p class="muted">Puedes ver su calendario y la próxima fecha estimada. No puedes modificar ningún dato del ciclo.</p>${isNativeAndroid() ? '<button class="primary-btn" data-action="pin-widget">Añadir widget a inicio</button>' : ''}</article>
      <article class="card"><h3>Desvincular</h3><p class="muted small">Al desvincularos dejarás de poder acceder inmediatamente a sus datos.</p><button class="danger-btn" data-action="unlink">Desvincular pareja</button></article>
    </section>`;
}

function renderUnpairedMan() {
  root.innerHTML = `
    <main class="shell"><div class="container">${renderTopbar()}${renderMessage()}
      <section class="card" style="max-width:620px;margin:60px auto">
        <div class="eyebrow" style="color:var(--muted)">Cuenta de pareja</div>
        <h2>Vincula tu cuenta con Enma</h2>
        <p class="muted">Pide a tu pareja que genere un código desde Perfil → Pareja. El código es temporal y de un solo uso.</p>
        <form data-form="claim-pair" class="form-grid">
          <div class="field full"><label>Código de pareja</label><input name="code" maxlength="8" minlength="6" required placeholder="Ej. A4C9F2" style="text-transform:uppercase;letter-spacing:.12em" /></div>
          <div class="field full"><button class="primary-btn" type="submit">Vincular pareja</button></div>
        </form>
      </section>
    </div></main>`;
}

function renderMonthCard(year, month) {
  const cells = monthCells(year, month, state.periods, state.settings || {});
  return `<article class="card calendar-card">
    <div class="month-head"><h3>${monthNames[month]} ${year}</h3></div>
    <div class="calendar-grid">${weekdays.map(w => `<div class="weekday">${w}</div>`).join('')}${cells.map(renderDay).join('')}</div>
    <div class="legend"><span><i style="background:var(--period)"></i>Registrado</span><span><i style="background:var(--predicted)"></i>Estimado</span></div>
  </article>`;
}

function renderMiniMonth(year, month, cells) {
  return `<div class="mini-month"><h4>${monthNames[month]}</h4><div class="calendar-grid">${weekdays.map(w => `<div class="weekday">${w}</div>`).join('')}${cells.map(renderDay).join('')}</div></div>`;
}

function renderDay(cell) {
  const classes = ['day'];
  if (!cell.inMonth) classes.push('other');
  if (cell.isToday) classes.push('today');
  if (cell.periodType) classes.push(cell.periodType);
  return `<div class="${classes.join(' ')}" title="${cell.date}">${cell.day}</div>`;
}

function renderModal() {
  if (!state.modal) return '';
  if (state.modal.type === 'period') {
    const item = state.modal.period;
    const start = item?.start_date || toISODate(new Date());
    const end = item?.end_date || toISODate(addDays(parseDate(start), (state.settings?.typical_period_days || 5) - 1));
    return `<div class="modal-backdrop" data-action="close-modal"><div class="modal" data-modal-stop><h3>${item ? 'Editar periodo' : 'Registrar periodo'}</h3><form data-form="modal-period" class="form-grid"><input type="hidden" name="id" value="${item?.id || ''}" /><div class="field"><label>Primer día</label><input type="date" name="startDate" value="${start}" required /></div><div class="field"><label>Último día</label><input type="date" name="endDate" value="${end}" required /></div><div class="field full actions"><button class="primary-btn" type="submit">Guardar</button><button class="ghost-btn" type="button" data-action="close-modal">Cancelar</button></div></form></div></div>`;
  }
  return '';
}

function renderMessage() {
  if (!state.message) return '';
  return `<div class="${state.message.type === 'success' ? 'success' : 'error'}" style="margin-bottom:14px">${escapeHtml(state.message.text)}</div>`;
}

async function handleClick(event) {
  const modalInner = event.target.closest('[data-modal-stop]');
  if (modalInner && event.target === modalInner) return;
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  if (action === 'auth-mode') { state.authMode = button.dataset.mode; state.message = null; return render(); }
  if (action === 'role') { state.authRole = button.dataset.role; return render(); }
  if (action === 'logout') { await signOut(); return; }
  if (action === 'view') { state.view = button.dataset.view; return render(); }
  if (action === 'year-prev') { state.yearView -= 1; return render(); }
  if (action === 'year-next') { state.yearView += 1; return render(); }
  if (action === 'month-prev') { shiftMonth(-1); return render(); }
  if (action === 'month-next') { shiftMonth(1); return render(); }
  if (action === 'open-period') { state.modal = { type: 'period', period: null }; return render(); }
  if (action === 'close-modal') { state.modal = null; return render(); }
  if (action === 'edit-period') { state.modal = { type: 'period', period: state.periods.find(p => p.id === button.dataset.id) }; return render(); }
  if (action === 'delete-period') return confirmDeletePeriod(button.dataset.id);
  if (action === 'create-pair-code') return generatePairCode();
  if (action === 'unlink') return unlinkPair();
  if (action === 'pin-widget') return pinWidget();
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const type = form.dataset.form;
  state.message = null;

  try {
    if (type === 'auth') {
      const payload = { email: data.get('email'), password: data.get('password') };
      if (state.authMode === 'signup') {
        const result = await signUp({ ...payload, fullName: data.get('fullName'), role: state.authRole });
        if (result.error) throw result.error;
        if (!result.data.session) state.message = { type:'success', text:'Cuenta creada. Revisa tu correo para confirmar el acceso.' };
      } else {
        const result = await signIn(payload);
        if (result.error) throw result.error;
      }
    }

    if (type === 'period' || type === 'modal-period') {
      validateDates(data.get('startDate'), data.get('endDate'));
      const id = data.get('id');
      const result = id
        ? await updatePeriod(id, state.profile.id, { startDate: data.get('startDate'), endDate: data.get('endDate') })
        : await addPeriod(state.profile.id, { startDate: data.get('startDate'), endDate: data.get('endDate') });
      if (result.error) throw result.error;
      state.modal = null;
      state.message = { type:'success', text: id ? 'Periodo actualizado.' : 'Periodo registrado.' };
      await loadData();
    }

    if (type === 'settings') {
      const result = await saveCycleSettings(state.profile.id, {
        typical_period_days: Number(data.get('typicalPeriodDays')),
        default_cycle_length: Number(data.get('cycleLength')),
        cycle_mode: data.get('cycleMode')
      });
      if (result.error) throw result.error;
      state.message = { type:'success', text:'Ajustes guardados.' };
      await loadData();
    }

    if (type === 'claim-pair') {
      const result = await claimPairCode(String(data.get('code')));
      if (result.error) throw result.error;
      state.message = { type:'success', text:'Pareja vinculada correctamente.' };
      await loadData();
    }
  } catch (error) {
    console.error(error);
    state.message = { type:'error', text:friendlyError(error) };
  }
  render();
}

async function confirmDeletePeriod(id) {
  if (!window.confirm('¿Eliminar este periodo? Esta acción no se puede deshacer.')) return;
  try {
    const result = await deletePeriod(id, state.profile.id);
    if (result.error) throw result.error;
    state.message = { type:'success', text:'Periodo eliminado.' };
    await loadData();
  } catch (error) {
    state.message = { type:'error', text:friendlyError(error) };
  }
  render();
}

async function generatePairCode() {
  try {
    const result = await createPairCode();
    if (result.error) throw result.error;
    state.pairCode = result.data;
    state.message = { type:'success', text:'Código generado. Compártelo solo con tu pareja.' };
  } catch (error) {
    state.message = { type:'error', text:friendlyError(error) };
  }
  render();
}

async function unlinkPair() {
  if (!window.confirm('¿Quieres desvincular la pareja? El acceso se revocará de inmediato.')) return;
  try {
    const result = await revokePartnership();
    if (result.error) throw result.error;
    state.message = { type:'success', text:'Pareja desvinculada.' };
    await loadData();
  } catch (error) {
    state.message = { type:'error', text:friendlyError(error) };
  }
  render();
}

async function pinWidget() {
  try {
    await syncWidget();
    const result = await requestPinAndroidWidget();
    if (result?.supported === false) throw new Error('El lanzador de tu móvil no permite fijar widgets automáticamente. Añádelo desde la pantalla de inicio de Android.');
    state.message = { type:'success', text:'Solicitud de widget enviada a Android.' };
  } catch (error) {
    state.message = { type:'error', text:friendlyError(error) };
  }
  render();
}

async function syncWidget() {
  if (!isNativeAndroid()) return;
  if (state.profile?.role === 'man' && !state.partnership) {
    await updateAndroidWidget({ title:'Enma', daysRemaining:'—', nextDate:'Sin pareja vinculada', personName:'', status:'Vincula tu cuenta en Enma' });
    return;
  }
  const next = getNextPeriod(state.periods, state.settings || {});
  const personName = state.profile?.role === 'man' ? (state.partnerProfile?.full_name || 'Pareja') : (state.profile?.full_name || 'Enma');
  await updateAndroidWidget({
    title: 'Enma',
    personName,
    daysRemaining: next ? String(Math.max(0, next.daysRemaining)) : '—',
    nextDate: next ? formatDateEs(next.date,{short:true}) : 'Sin datos',
    status: next ? (next.daysRemaining < 0 ? `${next.overdueDays} días sobre la estimación` : next.daysRemaining === 0 ? 'Fecha estimada: hoy' : 'Hasta la próxima regla estimada') : 'Registra un periodo para calcularla'
  });
}

function shiftMonth(delta) {
  const date = new Date(state.calendarYear, state.calendarMonth + delta, 1, 12);
  state.calendarYear = date.getFullYear();
  state.calendarMonth = date.getMonth();
}

function validateDates(start, end) {
  if (!start || !end) throw new Error('Indica las dos fechas del periodo.');
  const a = parseDate(start);
  const b = parseDate(end);
  if (b < a) throw new Error('El último día no puede ser anterior al primero.');
  const days = Math.round((b - a) / 86400000) + 1;
  if (days > 30) throw new Error('Revisa las fechas: el periodo registrado supera 30 días.');
}

function modeLabel(mode) {
  if (mode === 'regular') return 'Regular';
  if (mode === 'irregular') return 'Irregular';
  return 'Aprendiendo';
}

function friendlyError(error) {
  const message = String(error?.message || error || 'Ha ocurrido un error.');
  if (message.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
  if (message.includes('User already registered')) return 'Ya existe una cuenta con ese email.';
  if (message.includes('Password should be')) return 'La contraseña no cumple los requisitos mínimos.';
  if (message.includes('pairing code') || message.includes('Código')) return message;
  if (message.includes('duplicate key')) return 'Ese registro ya existe.';
  return message;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]));
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  }
}
