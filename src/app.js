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
const REMEMBER_KEY = 'enma.rememberSession';
const SESSION_TAB_KEY = 'enma.sessionActive';

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
  pairCode: null,
  rememberSession: readRememberPreference()
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
  const remembered = readRememberPreference();
  state.rememberSession = remembered;

  if (data.session && !remembered && sessionStorage.getItem(SESSION_TAB_KEY) !== '1') {
    await signOut();
    state.session = null;
  } else {
    state.session = data.session;
    if (state.session) {
      if (!remembered) sessionStorage.setItem(SESSION_TAB_KEY, '1');
      await loadData();
    }
  }

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
    <main class="app-shell">
      <div class="app-container">
        ${renderTopbar()}
        ${renderMessage()}
        ${state.loading ? '<div class="status-banner">Actualizando información…</div>' : ''}
        ${content}
      </div>
    </main>
    ${renderNav(role)}
    ${renderModal()}
  `;
}

function renderSetup() {
  root.innerHTML = `
    <main class="auth-wrap">
      <section class="auth-card setup-card">
        ${renderBrand('Configuración inicial')}
        <h1>Conecta Enma con Supabase</h1>
        <p class="muted">La aplicación está lista. Solo necesita tu proyecto de Supabase para sincronizar cuentas, periodos y pareja.</p>
        <div class="notice compact-list">
          <span>1. Ejecuta <code>supabase/schema.sql</code>.</span>
          <span>2. Añade <code>VITE_SUPABASE_URL</code>.</span>
          <span>3. Añade <code>VITE_SUPABASE_ANON_KEY</code>.</span>
          <span>4. Vuelve a compilar la web o el APK.</span>
        </div>
      </section>
    </main>`;
}

function renderLoading() {
  root.innerHTML = `
    <main class="auth-wrap">
      <section class="auth-card loading-card">
        ${renderBrand('Tu espacio personal')}
        <div class="loader-line"><span></span></div>
        <p class="muted small">Cargando tus datos…</p>
      </section>
    </main>`;
}

function renderAuth() {
  const signup = state.authMode === 'signup';
  root.innerHTML = `
    <main class="auth-wrap">
      <section class="auth-card">
        <div class="auth-heading">
          ${renderBrand('Tu ciclo, más claro')}
          <h1>${signup ? 'Crea tu espacio' : 'Bienvenida a Enma'}</h1>
          <p class="muted">${signup ? 'Configura tu cuenta en menos de un minuto.' : 'Accede a tu calendario y seguimiento.'}</p>
        </div>

        <div class="auth-tabs" role="tablist">
          <button data-action="auth-mode" data-mode="login" class="${!signup ? 'active' : ''}">Entrar</button>
          <button data-action="auth-mode" data-mode="signup" class="${signup ? 'active' : ''}">Crear cuenta</button>
        </div>

        ${renderMessage()}

        <form data-form="auth" class="auth-form">
          ${signup ? `
            <div class="field">
              <label>Nombre</label>
              <input name="fullName" autocomplete="name" required maxlength="60" placeholder="Tu nombre" />
            </div>
            <div class="field">
              <label>Tipo de cuenta</label>
              <div class="role-cards">
                <button type="button" class="role-card ${state.authRole === 'woman' ? 'active' : ''}" data-action="role" data-role="woman">
                  <span class="role-symbol">♀</span><span><strong>Mujer</strong><small>Control completo del ciclo</small></span>
                </button>
                <button type="button" class="role-card ${state.authRole === 'man' ? 'active' : ''}" data-action="role" data-role="man">
                  <span class="role-symbol">♡</span><span><strong>Pareja</strong><small>Vista autorizada en lectura</small></span>
                </button>
              </div>
            </div>` : ''}

          <div class="field">
            <label>Email</label>
            <input name="email" type="email" autocomplete="email" required placeholder="nombre@correo.com" />
          </div>
          <div class="field">
            <label>Contraseña</label>
            <input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required placeholder="Mínimo 8 caracteres" />
          </div>

          ${!signup ? `
            <label class="remember-row">
              <input type="checkbox" name="remember" ${state.rememberSession ? 'checked' : ''} />
              <span><strong>Mantener sesión iniciada</strong><small>No tendrás que volver a identificarte al cerrar Enma.</small></span>
            </label>` : ''}

          <button class="primary-btn large" type="submit">${signup ? 'Crear mi cuenta' : 'Entrar en Enma'}</button>
        </form>

        <p class="legal-note">Enma ofrece estimaciones orientativas basadas en los registros introducidos. No sustituye asesoramiento sanitario ni debe usarse como método anticonceptivo.</p>
      </section>
    </main>`;
}

function renderBrand(subtitle = '') {
  return `<div class="brand"><div class="brand-mark">E</div><div><div class="brand-name">Enma</div>${subtitle ? `<div class="brand-sub">${escapeHtml(subtitle)}</div>` : ''}</div></div>`;
}

function renderTopbar() {
  const name = state.profile?.full_name || '';
  const firstName = name.trim().split(/\s+/)[0] || 'Enma';
  return `
    <header class="topbar">
      <div class="topbar-copy">
        <div class="mobile-brand">${renderBrand('')}</div>
        <div>
          <p class="topbar-kicker">${state.profile?.role === 'woman' ? 'Tu espacio personal' : 'Vista de pareja'}</p>
          <h1>Hola, ${escapeHtml(firstName)}</h1>
        </div>
      </div>
      <div class="topbar-actions">
        <span class="profile-chip"><span class="avatar">${escapeHtml(firstName.charAt(0).toUpperCase())}</span><span>${state.profile?.role === 'woman' ? 'Mujer' : 'Pareja'}</span></span>
        <button class="icon-btn subtle" aria-label="Cerrar sesión" title="Cerrar sesión" data-action="logout">${icon('logout')}</button>
      </div>
    </header>`;
}

function renderNav(role) {
  const items = role === 'woman'
    ? [['home','Inicio','home'],['calendar','Calendario','calendar'],['record','Registrar','plus'],['profile','Perfil','user']]
    : [['home','Resumen','home'],['calendar','Calendario','calendar'],['profile','Pareja','heart']];
  return `<nav class="bottom-nav" aria-label="Navegación principal" style="--nav-items:${items.length}">
    ${items.map(([key,label,ico]) => `<button class="${state.view === key ? 'active' : ''}" data-action="view" data-view="${key}">${icon(ico)}<span>${label}</span></button>`).join('')}
  </nav>`;
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
  const countdownLabel = !next ? 'sin datos' : next.daysRemaining > 1 ? 'días' : next.daysRemaining === 1 ? 'día' : next.daysRemaining === 0 ? 'hoy' : next.overdueDays === 1 ? 'día de retraso estimado' : 'días de retraso estimado';
  const nextDate = next ? formatDateEs(next.date) : 'Añade un periodo para comenzar';

  return `
    <section class="hero-card">
      <div class="hero-content">
        <div class="eyebrow">${partnerMode ? `Ciclo de ${escapeHtml(titleName)}` : 'Próxima regla estimada'}</div>
        <div class="countdown-row"><strong>${countdownText}</strong><span>${countdownLabel}</span></div>
        <div class="hero-date">${nextDate}</div>
        <div class="hero-tags">
          <span>${icon('activity')} Ciclo ${modeLabel(mode).toLowerCase()}</span>
          <span>${icon('clock')} Media ${avg} días</span>
        </div>
      </div>
      <div class="hero-orb"><span>${next ? String(new Date(next.date + 'T12:00:00').getDate()).padStart(2,'0') : '—'}</span><small>${next ? monthNames[new Date(next.date + 'T12:00:00').getMonth()].slice(0,3) : 'fecha'}</small></div>
    </section>

    <section class="quick-grid">
      ${!partnerMode ? `<button class="quick-action" data-action="open-period"><span class="quick-icon">${icon('plus')}</span><span><strong>Registrar periodo</strong><small>Añadir nuevas fechas</small></span></button>` : ''}
      <button class="quick-action" data-action="view" data-view="calendar"><span class="quick-icon">${icon('calendar')}</span><span><strong>Calendario anual</strong><small>Ver previsiones</small></span></button>
      ${partnerMode && isNativeAndroid() ? `<button class="quick-action" data-action="pin-widget"><span class="quick-icon">${icon('widget')}</span><span><strong>Añadir widget</strong><small>Formato compacto 3×1</small></span></button>` : ''}
      <button class="quick-action" data-action="view" data-view="profile"><span class="quick-icon">${icon('settings')}</span><span><strong>${partnerMode ? 'Pareja' : 'Ajustes'}</strong><small>${partnerMode ? 'Gestionar vinculación' : 'Personalizar el ciclo'}</small></span></button>
    </section>

    <section class="stats-grid">
      <article class="stat-card"><span class="stat-icon">${icon('activity')}</span><div><strong>${avg}</strong><span>Días de ciclo</span></div></article>
      <article class="stat-card"><span class="stat-icon">${icon('droplet')}</span><div><strong>${state.settings?.typical_period_days || 5}</strong><span>Días de periodo</span></div></article>
      <article class="stat-card"><span class="stat-icon">${icon('history')}</span><div><strong>${state.periods.length}</strong><span>Registros</span></div></article>
    </section>

    <div class="section-title">
      <div><p class="section-kicker">Vista rápida</p><h2>Este mes</h2></div>
      <button class="text-btn" data-action="view" data-view="calendar">Ver calendario ${icon('arrow')}</button>
    </div>

    <section class="content-grid">
      ${renderMonthCard(new Date().getFullYear(), new Date().getMonth())}
      <article class="card insights-card">
        <div class="card-title-row"><div><p class="section-kicker">Seguimiento</p><h3>Irregularidades y cambios</h3></div><span class="soft-badge">${irregularities.length || 0}</span></div>
        ${irregularities.length
          ? `<div class="insight-list">${irregularities.map(i => `<div class="insight ${i.severity === 'attention' ? 'attention' : ''}"><span>${icon(i.severity === 'attention' ? 'alert' : 'check')}</span><p>${escapeHtml(i.message)}</p></div>`).join('')}</div>`
          : `<div class="empty-state"><span class="empty-icon">${icon('check')}</span><strong>Sin cambios destacados</strong><p>Tus registros recientes no muestran variaciones relevantes.</p></div>`}
        <p class="foot-note">Estas alertas comparan tus propios registros y no sustituyen una valoración sanitaria.</p>
      </article>
    </section>`;
}

function renderCalendarPage(partnerMode) {
  const label = partnerMode ? `Calendario de ${escapeHtml(state.partnerProfile?.full_name || 'tu pareja')}` : 'Tu calendario';
  const months = yearMonths(state.yearView, state.periods, state.settings || {});
  return `
    <div class="page-heading">
      <div><p class="section-kicker">Previsión anual</p><h2>${label}</h2><p>Periodos registrados y fechas estimadas.</p></div>
      <div class="segmented-control"><button class="icon-btn" data-action="year-prev" aria-label="Año anterior">${icon('chevron-left')}</button><span>${state.yearView}</span><button class="icon-btn" data-action="year-next" aria-label="Año siguiente">${icon('chevron-right')}</button></div>
    </div>

    <article class="card year-card">
      <div class="year-grid">${months.map(({ month, cells }) => renderMiniMonth(state.yearView, month, cells)).join('')}</div>
      ${renderLegend()}
    </article>

    <div class="section-title">
      <div><p class="section-kicker">Detalle</p><h2>${capitalize(monthNames[state.calendarMonth])} ${state.calendarYear}</h2></div>
      <div class="segmented-control compact"><button class="icon-btn" data-action="month-prev">${icon('chevron-left')}</button><button class="icon-btn" data-action="month-next">${icon('chevron-right')}</button></div>
    </div>
    ${renderMonthCard(state.calendarYear, state.calendarMonth)}`;
}

function renderRecordPage() {
  const sorted = [...state.periods].sort((a,b) => b.start_date.localeCompare(a.start_date));
  return `
    <div class="page-heading">
      <div><p class="section-kicker">Seguimiento</p><h2>Registrar periodo</h2><p>Guarda las fechas reales para mejorar las próximas estimaciones.</p></div>
    </div>

    <section class="content-grid record-layout">
      <article class="card sticky-card">
        <div class="card-title-row"><div><p class="section-kicker">Nuevo registro</p><h3>Fechas del periodo</h3></div><span class="soft-icon">${icon('droplet')}</span></div>
        <form data-form="period" class="form-grid">
          <div class="field"><label>Primer día</label><input type="date" name="startDate" value="${toISODate(new Date())}" required /></div>
          <div class="field"><label>Último día</label><input type="date" name="endDate" value="${toISODate(addDays(new Date(), (state.settings?.typical_period_days || 5) - 1))}" required /></div>
          <div class="field full"><button class="primary-btn" type="submit">${icon('check')} Guardar periodo</button></div>
        </form>
        <div class="inline-tip">${icon('info')} Puedes ajustar la duración habitual desde Perfil.</div>
      </article>

      <article class="card">
        <div class="card-title-row"><div><p class="section-kicker">Historial</p><h3>Periodos registrados</h3></div><span class="soft-badge">${sorted.length}</span></div>
        ${sorted.length ? `<div class="history-list">${sorted.map(p => `
          <div class="history-item">
            <span class="history-dot"></span>
            <div class="history-copy"><strong>${formatDateEs(p.start_date,{short:true})} – ${formatDateEs(p.end_date || p.start_date,{short:true})}</strong><span>${periodDuration(p)} días</span></div>
            <div class="row-actions"><button class="mini-btn" data-action="edit-period" data-id="${p.id}" aria-label="Editar">${icon('edit')}</button><button class="mini-btn danger" data-action="delete-period" data-id="${p.id}" aria-label="Eliminar">${icon('trash')}</button></div>
          </div>`).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">${icon('history')}</span><strong>Aún no hay registros</strong><p>Cuando añadas tu primer periodo aparecerá aquí.</p></div>`}
      </article>
    </section>`;
}

function renderWomanProfile() {
  return `
    <div class="page-heading"><div><p class="section-kicker">Personalización</p><h2>Perfil y ajustes</h2><p>Adapta Enma a tu ciclo y gestiona el acceso de tu pareja.</p></div></div>

    <section class="content-grid">
      <article class="card">
        <div class="card-title-row"><div><p class="section-kicker">Mi ciclo</p><h3>Ajustes de cálculo</h3></div><span class="soft-icon">${icon('settings')}</span></div>
        <form data-form="settings" class="form-grid">
          <div class="field"><label>Días habituales de periodo</label><input type="number" name="typicalPeriodDays" min="1" max="15" value="${state.settings?.typical_period_days || 5}" required /></div>
          <div class="field"><label>Duración inicial del ciclo</label><input type="number" name="cycleLength" min="15" max="60" value="${state.settings?.default_cycle_length || 28}" required /></div>
          <div class="field full"><label>Regularidad</label><select name="cycleMode"><option value="auto" ${state.settings?.cycle_mode === 'auto' ? 'selected' : ''}>Automático según mis registros</option><option value="regular" ${state.settings?.cycle_mode === 'regular' ? 'selected' : ''}>Regular</option><option value="irregular" ${state.settings?.cycle_mode === 'irregular' ? 'selected' : ''}>Irregular</option></select></div>
          <div class="field full"><button class="primary-btn" type="submit">Guardar cambios</button></div>
        </form>
        <p class="foot-note">La duración inicial se utiliza mientras todavía no haya suficientes periodos para calcular una media propia.</p>
      </article>

      <article class="card">
        <div class="card-title-row"><div><p class="section-kicker">Compartir</p><h3>Pareja</h3></div><span class="soft-icon">${icon('heart')}</span></div>
        ${state.partnership ? `
          <div class="success-panel">${icon('check')}<div><strong>Pareja vinculada</strong><p>Puede consultar el ciclo en modo lectura, pero no modificar tus datos.</p></div></div>
          <button class="secondary-btn danger-text" data-action="unlink">Desvincular pareja</button>` : `
          <p class="muted">Genera un código temporal y compártelo solo con la persona que quieras vincular.</p>
          ${state.pairCode ? `<div class="pair-code"><small>Código de vinculación</small><strong>${state.pairCode}</strong><span>Caduca en 24 horas · un solo uso</span></div>` : '<div class="inline-tip">Aún no has generado ningún código.</div>'}
          <button class="primary-btn" data-action="create-pair-code">${icon('link')} Generar código de pareja</button>`}
      </article>
    </section>

    ${renderSessionCard()}

    <article class="privacy-strip">${icon('shield')}<div><strong>Privacidad por diseño</strong><p>El acceso de pareja es revocable y está limitado a lectura sobre los datos autorizados.</p></div></article>`;
}

function renderManProfile() {
  return `
    <div class="page-heading"><div><p class="section-kicker">Vinculación</p><h2>Pareja</h2><p>Consulta el ciclo compartido y gestiona tu sesión.</p></div></div>

    <section class="content-grid">
      <article class="card partner-card">
        <div class="partner-avatar">${escapeHtml((state.partnerProfile?.full_name || 'E').charAt(0).toUpperCase())}</div>
        <div><p class="section-kicker">Pareja vinculada</p><h3>${escapeHtml(state.partnerProfile?.full_name || 'Pareja')}</h3><p class="muted">Puedes ver su calendario y próxima fecha estimada en modo de solo lectura.</p></div>
        ${isNativeAndroid() ? `<button class="primary-btn" data-action="pin-widget">${icon('widget')} Añadir widget 3×1</button>` : ''}
      </article>
      <article class="card">
        <div class="card-title-row"><div><p class="section-kicker">Acceso</p><h3>Desvincular</h3></div><span class="soft-icon">${icon('unlink')}</span></div>
        <p class="muted">Al desvincular la pareja dejarás de poder consultar sus datos inmediatamente.</p>
        <button class="secondary-btn danger-text" data-action="unlink">Desvincular pareja</button>
      </article>
    </section>

    ${renderSessionCard()}`;
}

function renderSessionCard() {
  return `
    <div class="section-title"><div><p class="section-kicker">Acceso</p><h2>Sesión</h2></div></div>
    <article class="card session-card">
      <div class="session-icon">${icon('lock')}</div>
      <div class="session-copy"><strong>Mantener sesión iniciada</strong><p>Si está activado, Enma seguirá abierta aunque cierres la app o el navegador.</p></div>
      <button class="switch ${state.rememberSession ? 'on' : ''}" data-action="toggle-remember" role="switch" aria-checked="${state.rememberSession}"><span></span></button>
    </article>`;
}

function renderUnpairedMan() {
  root.innerHTML = `
    <main class="app-shell"><div class="app-container">
      ${renderTopbar()}${renderMessage()}
      <section class="linking-card card">
        <span class="linking-icon">${icon('heart')}</span>
        <p class="section-kicker">Cuenta de pareja</p>
        <h2>Vincula tu cuenta con Enma</h2>
        <p class="muted">Pide a tu pareja que genere un código desde Perfil → Pareja. El código dura 24 horas y solo puede usarse una vez.</p>
        <form data-form="claim-pair" class="claim-form">
          <div class="field"><label>Código de pareja</label><input name="code" maxlength="8" minlength="6" required placeholder="A4C9F2" class="pair-input" /></div>
          <button class="primary-btn large" type="submit">${icon('link')} Vincular pareja</button>
        </form>
        ${renderSessionCard()}
      </section>
    </div></main>`;
}

function renderMonthCard(year, month) {
  const cells = monthCells(year, month, state.periods, state.settings || {});
  return `<article class="card calendar-card">
    <div class="month-head"><div><p class="section-kicker">Calendario</p><h3>${capitalize(monthNames[month])} ${year}</h3></div></div>
    <div class="calendar-grid">${weekdays.map(w => `<div class="weekday">${w}</div>`).join('')}${cells.map(renderDay).join('')}</div>
    ${renderLegend()}
  </article>`;
}

function renderMiniMonth(year, month, cells) {
  return `<div class="mini-month"><h4>${capitalize(monthNames[month])}</h4><div class="calendar-grid">${weekdays.map(w => `<div class="weekday">${w}</div>`).join('')}${cells.map(renderDay).join('')}</div></div>`;
}

function renderLegend() {
  return `<div class="legend"><span><i class="recorded-dot"></i>Registrado</span><span><i class="predicted-dot"></i>Estimado</span></div>`;
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
    return `<div class="modal-backdrop" data-action="close-modal"><div class="modal" data-modal-stop>
      <div class="modal-head"><div><p class="section-kicker">Periodo</p><h3>${item ? 'Editar registro' : 'Registrar periodo'}</h3></div><button class="icon-btn" type="button" data-action="close-modal">${icon('close')}</button></div>
      <form data-form="modal-period" class="form-grid">
        <input type="hidden" name="id" value="${item?.id || ''}" />
        <div class="field"><label>Primer día</label><input type="date" name="startDate" value="${start}" required /></div>
        <div class="field"><label>Último día</label><input type="date" name="endDate" value="${end}" required /></div>
        <div class="field full modal-actions"><button class="primary-btn" type="submit">Guardar</button><button class="secondary-btn" type="button" data-action="close-modal">Cancelar</button></div>
      </form>
    </div></div>`;
  }
  return '';
}

function renderMessage() {
  if (!state.message) return '';
  return `<div class="message ${state.message.type === 'success' ? 'success' : 'error'}"><span>${icon(state.message.type === 'success' ? 'check' : 'alert')}</span><p>${escapeHtml(state.message.text)}</p></div>`;
}

async function handleClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  if (action === 'auth-mode') { state.authMode = button.dataset.mode; state.message = null; return render(); }
  if (action === 'role') { state.authRole = button.dataset.role; return render(); }
  if (action === 'logout') {
    sessionStorage.removeItem(SESSION_TAB_KEY);
    await signOut();
    return;
  }
  if (action === 'toggle-remember') {
    setRememberPreference(!state.rememberSession);
    state.message = { type:'success', text: state.rememberSession ? 'La sesión permanecerá iniciada.' : 'La sesión se cerrará al terminar esta sesión del navegador o la app.' };
    return render();
  }
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
        if (!result.data.session) state.message = { type:'success', text:'Cuenta creada. Si tu proyecto exige confirmación, revisa la configuración de Supabase Auth.' };
      } else {
        const remember = data.get('remember') === 'on';
        const result = await signIn(payload);
        if (result.error) throw result.error;
        setRememberPreference(remember);
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
    await updateAndroidWidget({ title:'Enma', daysRemaining:'—', nextDate:'Sin pareja', personName:'Enma', status:'Vincula tu cuenta' });
    return;
  }
  const next = getNextPeriod(state.periods, state.settings || {});
  const personName = state.profile?.role === 'man' ? (state.partnerProfile?.full_name || 'Pareja') : (state.profile?.full_name || 'Enma');
  await updateAndroidWidget({
    title: 'Enma',
    personName,
    daysRemaining: next ? String(next.daysRemaining >= 0 ? next.daysRemaining : next.overdueDays) : '—',
    nextDate: next ? formatDateEs(next.date,{short:true}) : 'Sin datos',
    status: next ? (next.daysRemaining < 0 ? 'Sobre la estimación' : next.daysRemaining === 0 ? 'Estimación: hoy' : 'Próxima regla') : 'Sin registros'
  });
}

function setRememberPreference(value) {
  state.rememberSession = Boolean(value);
  localStorage.setItem(REMEMBER_KEY, state.rememberSession ? 'true' : 'false');
  if (state.rememberSession) sessionStorage.removeItem(SESSION_TAB_KEY);
  else sessionStorage.setItem(SESSION_TAB_KEY, '1');
}

function readRememberPreference() {
  return localStorage.getItem(REMEMBER_KEY) !== 'false';
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
  if (message.toLowerCase().includes('email rate limit exceeded')) return 'Supabase ha limitado temporalmente los registros por email. Puedes entrar con un usuario ya creado o revisar Auth en Supabase.';
  if (message.includes('pairing code') || message.includes('Código')) return message;
  if (message.includes('duplicate key')) return 'Ese registro ya existe.';
  return message;
}

function capitalize(value) {
  const text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'\"]/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]));
}

function icon(name) {
  const paths = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    activity: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    droplet: '<path d="M12 2.5S5.5 10 5.5 15a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5Z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    widget: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 9h8M8 13h5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<path d="M12 3 2.7 20h18.6L12 3Z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    edit: '<path d="M12 20h9"/><path d="m16.5 3.5 4 4L8 20l-5 1 1-5L16.5 3.5Z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
    unlink: '<path d="m3 3 18 18"/><path d="M10.6 13.4a5 5 0 0 0 6.5-.3l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M13.4 10.6a5 5 0 0 0-6.5.3l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.8 3 7.6 7.5 9.5 4.5-1.9 7.5-4.7 7.5-9.5V6L12 3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  }
}
