(function () {
  'use strict';

  var STORAGE_KEY = 'facturacion_v1';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_SHORT_LABEL = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  var PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Cheque', 'Tarjeta', 'Otro'];

  var TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/></svg>';
  var CHEVRON_RIGHT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  var CHEVRON_LEFT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

  function navBarHTML(titleHTML, formId, actionLabel) {
    var left = '<button type="button" class="navbar-back" data-close aria-label="Cerrar">' + CHEVRON_LEFT_SVG + '</button>';
    var right = formId
      ? '<button type="submit" form="' + formId + '" class="navbar-action">' + (actionLabel || 'Guardar') + '</button>'
      : '<span class="navbar-spacer"></span>';
    return '<div class="modal-header">' + left + '<h2 class="navbar-title">' + titleHTML + '</h2>' + right + '</div>';
  }

  var state = loadState();
  var invoiceFilters = { search: '', status: 'all', from: '', to: '' };
  var quoteFilters = { search: '', status: 'all' };
  var clientFilter = '';
  var productFilter = '';
  var paymentFilters = { search: '', from: '', to: '' };

  // ---------- state ----------

  function defaultState() {
    return {
      onboarded: false,
      settings: {
        companyName: 'C&M Truck & Auto Wash',
        ein: '',
        logo: window.DEFAULT_LOGO || null,
        taxRate: 0,
        dueDays: 15,
        invoicePrefix: 'INV-',
        nextInvoiceNumber: 1,
        quotePrefix: 'EST-',
        nextQuoteNumber: 1,
        paymentLink: '',
        backupReminderDays: 14,
        lastBackupAt: null
      },
      clients: [],
      products: [],
      invoices: [],
      quotes: [],
      bannerDismissedAt: null
    };
  }

  function loadState() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') return defaultState();
    var base = defaultState();
    raw.settings = Object.assign(base.settings, raw.settings || {});
    raw.clients = raw.clients || [];
    raw.products = raw.products || [];
    raw.invoices = raw.invoices || [];
    raw.quotes = raw.quotes || [];
    raw.onboarded = raw.onboarded === true;
    return raw;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- formatting ----------

  function money(n) {
    n = Number(n) || 0;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return '';
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function addDaysISO(iso, days) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + Number(days || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- domain helpers ----------

  function getClient(id) { return state.clients.find(function (c) { return c.id === id; }); }
  function getProduct(id) { return state.products.find(function (p) { return p.id === id; }); }
  function getInvoice(id) { return state.invoices.find(function (i) { return i.id === id; }); }
  function getQuote(id) { return state.quotes.find(function (q) { return q.id === id; }); }

  function invoiceSubtotal(inv) {
    return inv.items.reduce(function (sum, it) { return sum + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
  }
  function invoiceTaxAmount(inv) {
    return invoiceSubtotal(inv) * (Number(inv.taxRate) || 0) / 100;
  }
  function invoiceTotal(inv) {
    return invoiceSubtotal(inv) + invoiceTaxAmount(inv);
  }
  function invoicePaid(inv) {
    return (inv.payments || []).reduce(function (sum, p) { return sum + (Number(p.amount) || 0); }, 0);
  }
  function invoiceBalance(inv) {
    return Math.max(0, Math.round((invoiceTotal(inv) - invoicePaid(inv)) * 100) / 100);
  }
  function invoiceStatus(inv) {
    var balance = invoiceBalance(inv);
    if (balance <= 0.004) return 'paid';
    if (inv.dueDate && inv.dueDate < todayISO()) return 'overdue';
    return 'pending';
  }
  function statusLabel(s) {
    return { paid: 'Pagada', pending: 'Pendiente', overdue: 'Vencida' }[s] || s;
  }
  function statusBadge(s) {
    return '<span class="badge badge-' + s + '">' + statusLabel(s) + '</span>';
  }

  function clientBalance(clientId) {
    return state.invoices
      .filter(function (i) { return i.clientId === clientId; })
      .reduce(function (sum, i) { return sum + invoiceBalance(i); }, 0);
  }

  function nextFolioPreview() {
    return state.settings.invoicePrefix + String(state.settings.nextInvoiceNumber).padStart(4, '0');
  }

  function nextQuotePreview() {
    return state.settings.quotePrefix + String(state.settings.nextQuoteNumber).padStart(4, '0');
  }

  function quoteSubtotal(q) {
    return q.items.reduce(function (sum, it) { return sum + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
  }
  function quoteTaxAmount(q) {
    return quoteSubtotal(q) * (Number(q.taxRate) || 0) / 100;
  }
  function quoteTotal(q) {
    return quoteSubtotal(q) + quoteTaxAmount(q);
  }
  function quoteStatusLabel(s) {
    return { draft: 'Borrador', sent: 'Enviada', approved: 'Aprobada', declined: 'Rechazada', converted: 'Convertida' }[s] || s;
  }
  function quoteStatusBadgeClass(s) {
    return { draft: 'pending', sent: 'pending', approved: 'paid', declined: 'overdue', converted: 'paid' }[s] || 'pending';
  }
  function quoteStatusBadge(s) {
    return '<span class="badge badge-' + quoteStatusBadgeClass(s) + '">' + quoteStatusLabel(s) + '</span>';
  }

  function clientInvoices(clientId) {
    return state.invoices.filter(function (i) { return i.clientId === clientId; })
      .sort(function (a, b) { return (b.issueDate || '').localeCompare(a.issueDate || ''); });
  }
  function clientQuotes(clientId) {
    return state.quotes.filter(function (q) { return q.clientId === clientId; })
      .sort(function (a, b) { return (b.issueDate || '').localeCompare(a.issueDate || ''); });
  }

  function openMailto(to, subject, body) {
    var url = 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    var a = document.createElement('a');
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- routing ----------

  var VIEWS = ['dashboard', 'invoices', 'quotes', 'clients', 'catalog', 'payments', 'settings'];

  function currentViewFromHash() {
    var h = (location.hash || '').replace('#', '');
    return VIEWS.indexOf(h) >= 0 ? h : 'dashboard';
  }

  function setView(name) {
    VIEWS.forEach(function (v) {
      document.getElementById('view-' + v).classList.toggle('active', v === name);
    });
    document.querySelectorAll('#sidenav a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.view === name);
    });
    var moreViews = ['catalog', 'payments', 'settings'];
    document.querySelectorAll('#bottombar button[data-view]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === name);
    });
    document.getElementById('more-tab-btn').classList.toggle('active', moreViews.indexOf(name) !== -1);
    renderView(name);
  }

  function renderView(name) {
    if (name === 'dashboard') renderDashboard();
    else if (name === 'invoices') renderInvoices();
    else if (name === 'quotes') renderQuotes();
    else if (name === 'clients') renderClients();
    else if (name === 'catalog') renderCatalog();
    else if (name === 'payments') renderPayments();
    else if (name === 'settings') renderSettings();
  }

  // ---------- dashboard ----------

  function renderDashboard() {
    var now = new Date();
    var monthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    var invoicedThisMonth = 0, overdueCount = 0, pendingTotal = 0, collectedThisMonth = 0;
    state.invoices.forEach(function (inv) {
      if ((inv.issueDate || '').slice(0, 7) === monthKey) invoicedThisMonth += invoiceTotal(inv);
      var status = invoiceStatus(inv);
      if (status === 'overdue') overdueCount++;
      if (status !== 'paid') pendingTotal += invoiceBalance(inv);
      (inv.payments || []).forEach(function (p) {
        if ((p.date || '').slice(0, 7) === monthKey) collectedThisMonth += Number(p.amount) || 0;
      });
    });

    document.getElementById('kpi-invoiced').textContent = money(invoicedThisMonth);
    document.getElementById('kpi-collected').textContent = money(collectedThisMonth);
    document.getElementById('kpi-pending').textContent = money(pendingTotal);
    document.getElementById('kpi-overdue').textContent = String(overdueCount);

    renderRevenueChart();
    renderTopClients();
    renderDashInvoicesTable();
  }

  function renderRevenueChart() {
    var now = new Date();
    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: MONTHS_SHORT_LABEL[d.getMonth()] });
    }
    var totals = months.map(function (m) {
      return state.invoices.reduce(function (sum, inv) {
        return (inv.issueDate || '').slice(0, 7) === m.key ? sum + invoiceTotal(inv) : sum;
      }, 0);
    });
    var max = Math.max.apply(null, totals.concat([1]));
    var el = document.getElementById('revenue-chart');
    el.innerHTML = months.map(function (m, idx) {
      var h = Math.max(4, Math.round((totals[idx] / max) * 120));
      var isCurrent = idx === months.length - 1;
      return '<div class="chart-bar-wrap">' +
        '<div class="chart-value">' + money(totals[idx]).replace('.00', '') + '</div>' +
        '<div class="chart-bar' + (isCurrent ? ' current' : '') + '" style="height:' + h + 'px"></div>' +
        '<div class="chart-label">' + m.label + '</div>' +
        '</div>';
    }).join('');
  }

  function renderTopClients() {
    var totals = {};
    state.invoices.forEach(function (inv) {
      totals[inv.clientId] = (totals[inv.clientId] || 0) + invoiceTotal(inv);
    });
    var rows = Object.keys(totals).map(function (id) {
      var c = getClient(id);
      return { name: c ? c.name : 'Cliente eliminado', total: totals[id] };
    }).sort(function (a, b) { return b.total - a.total; }).slice(0, 5);
    var el = document.getElementById('top-clients');
    if (!rows.length) { el.innerHTML = '<p class="empty-state">Aún no hay facturas.</p>'; return; }
    el.innerHTML = rows.map(function (r) {
      return '<div class="stack-row"><span>' + escapeHTML(r.name) + '</span><span>' + money(r.total) + '</span></div>';
    }).join('');
  }

  function invoiceRowHTML(inv, withDelete) {
    var c = getClient(inv.clientId);
    var status = invoiceStatus(inv);
    return '<div class="list-row" data-open-invoice="' + inv.id + '">' +
      '<div class="list-row-lead">' +
      '<div class="list-row-title">' + escapeHTML(inv.number) + '</div>' +
      '<div class="list-row-sub">' + escapeHTML(c ? c.name : '—') + ' · Vence ' + fmtDate(inv.dueDate) + '</div>' +
      '</div>' +
      '<div class="list-row-trail">' +
      '<div class="list-row-amount">' + money(invoiceTotal(inv)) + '</div>' +
      statusBadge(status) +
      '</div>' +
      (withDelete
        ? '<button type="button" class="list-row-delete" data-delete-invoice="' + inv.id + '" aria-label="Eliminar factura">' + TRASH_SVG + '</button>'
        : '<span class="list-row-chevron">' + CHEVRON_RIGHT_SVG + '</span>') +
      '</div>';
  }

  function renderDashInvoicesTable() {
    var rows = state.invoices.slice().sort(function (a, b) { return (b.issueDate || '').localeCompare(a.issueDate || ''); }).slice(0, 5);
    var el = document.getElementById('dash-invoices-list');
    el.innerHTML = rows.length
      ? rows.map(function (inv) { return invoiceRowHTML(inv, false); }).join('')
      : '<p class="list-row-empty">Aún no hay facturas.</p>';
  }

  // ---------- invoices view ----------

  function filteredInvoices() {
    var q = invoiceFilters.search.trim().toLowerCase();
    return state.invoices.filter(function (inv) {
      var c = getClient(inv.clientId);
      if (q) {
        var hay = (inv.number + ' ' + (c ? c.name : '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (invoiceFilters.status !== 'all' && invoiceStatus(inv) !== invoiceFilters.status) return false;
      if (invoiceFilters.from && inv.issueDate < invoiceFilters.from) return false;
      if (invoiceFilters.to && inv.issueDate > invoiceFilters.to) return false;
      return true;
    }).sort(function (a, b) { return (b.issueDate || '').localeCompare(a.issueDate || '') || b.number.localeCompare(a.number); });
  }

  function renderInvoices() {
    var rows = filteredInvoices();
    document.getElementById('invoices-empty').hidden = rows.length > 0;
    document.getElementById('invoices-list').innerHTML = rows.map(function (inv) { return invoiceRowHTML(inv, true); }).join('');
  }

  function invoiceExportRows(format) {
    var rows = filteredInvoices();
    if (format === 'csv-quickbooks') {
      var out = [];
      rows.forEach(function (inv) {
        var c = getClient(inv.clientId);
        inv.items.forEach(function (it) {
          out.push({
            InvoiceNo: inv.number,
            Customer: c ? c.name : '',
            InvoiceDate: inv.issueDate,
            DueDate: inv.dueDate,
            Item: it.description,
            ItemDescription: it.description,
            ItemQuantity: it.qty,
            ItemUnit: it.unit || '',
            ItemRate: it.price,
            ItemAmount: Math.round(it.qty * it.price * 100) / 100,
            Currency: 'USD'
          });
        });
      });
      return out;
    }
    return rows.map(function (inv) {
      var c = getClient(inv.clientId);
      return {
        Folio: inv.number,
        Cliente: c ? c.name : '',
        Correo: c ? c.email : '',
        FechaEmision: inv.issueDate,
        FechaVencimiento: inv.dueDate,
        Subtotal: Math.round(invoiceSubtotal(inv) * 100) / 100,
        SalesTax: Math.round(invoiceTaxAmount(inv) * 100) / 100,
        Total: Math.round(invoiceTotal(inv) * 100) / 100,
        Pagado: Math.round(invoicePaid(inv) * 100) / 100,
        Saldo: invoiceBalance(inv),
        Estado: statusLabel(invoiceStatus(inv))
      };
    });
  }

  function exportInvoices(format) {
    var rows = invoiceExportRows(format);
    if (!rows.length) { toast('No hay facturas para exportar con estos filtros.'); return; }
    var ws = XLSX.utils.json_to_sheet(rows);
    if (format === 'xlsx') {
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
      XLSX.writeFile(wb, 'facturas.xlsx');
    } else {
      var csv = XLSX.utils.sheet_to_csv(ws);
      downloadBlob(csv, format === 'csv-quickbooks' ? 'facturas-quickbooks.csv' : 'facturas.csv', 'text/csv;charset=utf-8;');
    }
  }

  function downloadBlob(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- quotes view ----------

  function filteredQuotes() {
    var q = quoteFilters.search.trim().toLowerCase();
    return state.quotes.filter(function (quote) {
      var c = getClient(quote.clientId);
      if (q) {
        var hay = (quote.number + ' ' + (c ? c.name : '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (quoteFilters.status !== 'all' && quote.status !== quoteFilters.status) return false;
      return true;
    }).sort(function (a, b) { return (b.issueDate || '').localeCompare(a.issueDate || '') || b.number.localeCompare(a.number); });
  }

  function renderQuotes() {
    var rows = filteredQuotes();
    document.getElementById('quotes-empty').hidden = rows.length > 0;
    document.getElementById('quotes-list').innerHTML = rows.map(function (q) {
      var c = getClient(q.clientId);
      return '<div class="list-row" data-open-quote="' + q.id + '">' +
        '<div class="list-row-lead">' +
        '<div class="list-row-title">' + escapeHTML(q.number) + '</div>' +
        '<div class="list-row-sub">' + escapeHTML(c ? c.name : '—') + ' · Vence ' + fmtDate(q.expiryDate) + '</div>' +
        '</div>' +
        '<div class="list-row-trail">' +
        '<div class="list-row-amount">' + money(quoteTotal(q)) + '</div>' +
        quoteStatusBadge(q.status) +
        '</div>' +
        '<button type="button" class="list-row-delete" data-delete-quote="' + q.id + '" aria-label="Eliminar cotización">' + TRASH_SVG + '</button>' +
        '</div>';
    }).join('');
  }

  // ---------- clients view ----------

  function filteredClients() {
    var q = clientFilter.trim().toLowerCase();
    return state.clients.filter(function (c) {
      if (!q) return true;
      return (c.name + ' ' + c.email + ' ' + c.phone).toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function renderClients() {
    var rows = filteredClients();
    document.getElementById('clients-empty').hidden = rows.length > 0;
    document.getElementById('clients-list').innerHTML = rows.map(function (c) {
      var balance = clientBalance(c.id);
      return '<div class="list-row" data-open-client="' + c.id + '">' +
        '<div class="list-row-lead">' +
        '<div class="list-row-title">' + escapeHTML(c.name) + '</div>' +
        '<div class="list-row-sub">' + escapeHTML(c.email || c.phone || 'Sin contacto') + '</div>' +
        '</div>' +
        '<div class="list-row-trail">' +
        '<div class="list-row-amount' + (balance > 0 ? '' : ' accent-good') + '">' + money(balance) + '</div>' +
        '</div>' +
        '<button type="button" class="list-row-delete" data-delete-client="' + c.id + '" aria-label="Eliminar cliente">' + TRASH_SVG + '</button>' +
        '</div>';
    }).join('');
  }

  // ---------- catalog view ----------

  function filteredProducts() {
    var q = productFilter.trim().toLowerCase();
    return state.products.filter(function (p) {
      return !q || p.name.toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function renderCatalog() {
    var rows = filteredProducts();
    document.getElementById('catalog-empty').hidden = rows.length > 0;
    document.getElementById('catalog-list').innerHTML = rows.map(function (p) {
      return '<div class="list-row" data-open-product="' + p.id + '">' +
        '<div class="list-row-lead">' +
        '<div class="list-row-title">' + escapeHTML(p.name) + '</div>' +
        '<div class="list-row-sub">' + escapeHTML(p.description || (p.unit ? 'por ' + p.unit : '')) + '</div>' +
        '</div>' +
        '<div class="list-row-trail"><div class="list-row-amount">' + money(p.price) + '</div></div>' +
        '<button type="button" class="list-row-delete" data-delete-product="' + p.id + '" aria-label="Eliminar producto">' + TRASH_SVG + '</button>' +
        '</div>';
    }).join('');
  }

  // ---------- payments view ----------

  function allPayments() {
    var list = [];
    state.invoices.forEach(function (inv) {
      var c = getClient(inv.clientId);
      (inv.payments || []).forEach(function (p) {
        list.push({ date: p.date, amount: p.amount, method: p.method, invoiceNumber: inv.number, clientName: c ? c.name : '—' });
      });
    });
    return list.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  }

  function renderPayments() {
    var q = paymentFilters.search.trim().toLowerCase();
    var rows = allPayments().filter(function (p) {
      if (q && (p.clientName + ' ' + p.invoiceNumber).toLowerCase().indexOf(q) === -1) return false;
      if (paymentFilters.from && p.date < paymentFilters.from) return false;
      if (paymentFilters.to && p.date > paymentFilters.to) return false;
      return true;
    });
    document.getElementById('payments-empty').hidden = rows.length > 0;
    document.getElementById('payments-view-list').innerHTML = rows.map(function (p) {
      return '<div class="list-row not-navigable">' +
        '<div class="list-row-lead">' +
        '<div class="list-row-title">' + escapeHTML(p.clientName) + '</div>' +
        '<div class="list-row-sub">' + escapeHTML(p.invoiceNumber) + ' · ' + escapeHTML(p.method) + '</div>' +
        '</div>' +
        '<div class="list-row-trail"><div class="list-row-amount">' + money(p.amount) + '</div>' +
        '<div class="list-row-sub">' + fmtDate(p.date) + '</div></div>' +
        '</div>';
    }).join('');
  }

  // ---------- settings view ----------

  function renderSettings() {
    var s = state.settings;
    var companyForm = document.getElementById('settings-company-form');
    companyForm.companyName.value = s.companyName || '';
    companyForm.ein.value = s.ein || '';
    var previewWrap = document.getElementById('logo-preview-wrap');
    if (s.logo) {
      previewWrap.hidden = false;
      document.getElementById('logo-preview').src = s.logo;
    } else {
      previewWrap.hidden = true;
    }

    var invForm = document.getElementById('settings-invoicing-form');
    invForm.taxRate.value = s.taxRate;
    invForm.dueDays.value = s.dueDays;
    invForm.invoicePrefix.value = s.invoicePrefix;
    invForm.nextInvoiceNumber.value = s.nextInvoiceNumber;
    document.getElementById('folio-preview').textContent = nextFolioPreview();

    document.getElementById('settings-payment-form').paymentLink.value = s.paymentLink || '';

    var quotesForm = document.getElementById('settings-quotes-form');
    quotesForm.quotePrefix.value = s.quotePrefix;
    quotesForm.nextQuoteNumber.value = s.nextQuoteNumber;
    document.getElementById('quote-number-preview').textContent = nextQuotePreview();

    document.getElementById('settings-backup-form').backupReminderDays.value = s.backupReminderDays;
    document.getElementById('last-backup-line').textContent = s.lastBackupAt
      ? 'Último respaldo: ' + fmtDate(s.lastBackupAt.slice(0, 10)) + ' a las ' + new Date(s.lastBackupAt).toLocaleTimeString('en-US')
      : 'Todavía no has exportado un respaldo.';
  }

  function readImageAsResizedDataURL(file, maxSize) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
          var w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- backup ----------

  function exportBackup() {
    var data = JSON.stringify(state, null, 2);
    var stamp = todayISO();
    downloadBlob(data, 'facturacion-respaldo-' + stamp + '.json', 'application/json');
    state.settings.lastBackupAt = new Date().toISOString();
    saveState();
    renderSettings();
    updateBackupBanner();
    toast('Respaldo exportado.');
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); } catch (e) {
        toast('El archivo no es un respaldo válido.');
        return;
      }
      if (!parsed || !parsed.settings || !parsed.clients || !parsed.invoices) {
        toast('El archivo no tiene el formato esperado.');
        return;
      }
      if (!confirm('Esto reemplaza todos los datos actuales de este navegador con los del respaldo. ¿Continuar?')) return;
      state = parsed;
      state.products = state.products || [];
      saveState();
      renderView(currentViewFromHash());
      applyBrand();
      updateBackupBanner();
      toast('Respaldo importado.');
    };
    reader.readAsText(file);
  }

  function updateBackupBanner() {
    var banner = document.getElementById('backup-banner');
    var s = state.settings;
    if (!s.lastBackupAt) {
      var hasData = state.invoices.length || state.clients.length;
      if (!hasData) { banner.hidden = true; return; }
    }
    var days = s.lastBackupAt ? (Date.now() - new Date(s.lastBackupAt).getTime()) / 86400000 : Infinity;
    var dismissedRecently = state.bannerDismissedAt && (Date.now() - state.bannerDismissedAt) < 86400000;
    if (days >= (s.backupReminderDays || 14) && !dismissedRecently) {
      banner.hidden = false;
      banner.querySelector('span').textContent = s.lastBackupAt
        ? 'No respaldas tus datos hace ' + Math.floor(days) + ' días.'
        : 'Aún no has hecho un respaldo de tus datos.';
    } else {
      banner.hidden = true;
    }
  }

  // ---------- brand ----------

  function applyBrand() {
    document.getElementById('brand-name').textContent = state.settings.companyName || 'Facturación';
    var logoEl = document.getElementById('brand-logo');
    if (state.settings.logo) { logoEl.src = state.settings.logo; logoEl.hidden = false; }
    else { logoEl.hidden = true; }
  }

  // ---------- toast ----------

  function toast(msg) {
    var root = document.getElementById('toast-root');
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }

  // ---------- modal shell ----------

  function openModal(innerHTML) {
    var root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-overlay"><div class="modal">' + innerHTML + '</div></div>';
    root.querySelector('.modal-overlay').addEventListener('mousedown', function (e) {
      if (e.target === this) closeModal();
    });
  }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

  function openMoreSheet() {
    openModal(
      navBarHTML('Más', null) +
      '<div class="action-list">' +
      '<a href="#catalog" data-close>Catálogo</a>' +
      '<a href="#payments" data-close>Pagos</a>' +
      '<a href="#settings" data-close>Ajustes</a>' +
      '</div>'
    );
  }

  // ---------- client modal ----------

  function openClientModal(client) {
    var isEdit = !!client;
    client = client || { name: '', email: '', phone: '', taxId: '', address: '' };
    var html = navBarHTML(isEdit ? 'Editar cliente' : 'Nuevo cliente', 'client-form') +
      '<form id="client-form" class="form-grid" style="max-width:none;">' +
      '<label>Nombre<input type="text" name="name" required value="' + escapeHTML(client.name) + '"></label>' +
      '<label>Correo<input type="email" name="email" value="' + escapeHTML(client.email) + '"></label>' +
      '<label>Teléfono<input type="text" name="phone" value="' + escapeHTML(client.phone) + '"></label>' +
      '<label>EIN / Tax ID<input type="text" name="taxId" value="' + escapeHTML(client.taxId) + '"></label>' +
      '<label>Dirección<input type="text" name="address" value="' + escapeHTML(client.address) + '"></label>' +
      '</form>';

    if (isEdit) {
      var invs = clientInvoices(client.id);
      var qts = clientQuotes(client.id);
      html += '<div class="modal-section"><h3>Facturas de este cliente</h3><div class="history-list">' +
        (invs.length ? invs.map(function (i) {
          return '<div class="history-row" data-open-invoice="' + i.id + '"><span>' + escapeHTML(i.number) + ' · ' + fmtDate(i.issueDate) + '</span>' +
            '<span style="display:flex;align-items:center;gap:6px;">' + money(invoiceTotal(i)) + ' ' + statusBadge(invoiceStatus(i)) + '<span class="list-row-chevron">' + CHEVRON_RIGHT_SVG + '</span></span></div>';
        }).join('') : '<p class="field-hint">Sin facturas todavía.</p>') + '</div></div>';
      html += '<div class="modal-section"><h3>Cotizaciones de este cliente</h3><div class="history-list">' +
        (qts.length ? qts.map(function (q) {
          return '<div class="history-row" data-open-quote="' + q.id + '"><span>' + escapeHTML(q.number) + ' · ' + fmtDate(q.issueDate) + '</span>' +
            '<span style="display:flex;align-items:center;gap:6px;">' + money(quoteTotal(q)) + ' ' + quoteStatusBadge(q.status) + '<span class="list-row-chevron">' + CHEVRON_RIGHT_SVG + '</span></span></div>';
        }).join('') : '<p class="field-hint">Sin cotizaciones todavía.</p>') + '</div></div>';
    }

    openModal(html);
    document.getElementById('client-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      var data = { name: fd.get('name').trim(), email: fd.get('email').trim(), phone: fd.get('phone').trim(), taxId: fd.get('taxId').trim(), address: fd.get('address').trim() };
      if (!data.name) return;
      if (isEdit) { Object.assign(client, data); }
      else { data.id = uid(); data.createdAt = todayISO(); state.clients.push(data); }
      saveState();
      closeModal();
      renderView(currentViewFromHash());
      toast('Cliente guardado.');
    });
  }

  function deleteClient(id) {
    var used = state.invoices.some(function (i) { return i.clientId === id; });
    if (used) { toast('No se puede eliminar: tiene facturas asociadas.'); return; }
    if (!confirm('¿Eliminar este cliente?')) return;
    state.clients = state.clients.filter(function (c) { return c.id !== id; });
    saveState();
    renderClients();
  }

  // ---------- product modal ----------

  function openProductModal(product) {
    var isEdit = !!product;
    product = product || { name: '', description: '', unit: '', price: '' };
    openModal(
      navBarHTML(isEdit ? 'Editar producto' : 'Nuevo producto o servicio', 'product-form') +
      '<form id="product-form" class="form-grid" style="max-width:none;">' +
      '<label>Nombre<input type="text" name="name" required value="' + escapeHTML(product.name) + '"></label>' +
      '<label>Descripción<input type="text" name="description" value="' + escapeHTML(product.description) + '"></label>' +
      '<label>Unidad (hrs, pieza, pie², gal...)<input type="text" name="unit" value="' + escapeHTML(product.unit) + '"></label>' +
      '<label>Precio<input type="number" name="price" min="0" step="0.01" required value="' + escapeHTML(product.price) + '"></label>' +
      '</form>'
    );
    document.getElementById('product-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      var data = { name: fd.get('name').trim(), description: fd.get('description').trim(), unit: fd.get('unit').trim(), price: Number(fd.get('price')) || 0 };
      if (!data.name) return;
      if (isEdit) { Object.assign(product, data); }
      else { data.id = uid(); state.products.push(data); }
      saveState();
      closeModal();
      renderCatalog();
      toast('Producto guardado.');
    });
  }

  function deleteProduct(id) {
    if (!confirm('¿Eliminar este producto del catálogo?')) return;
    state.products = state.products.filter(function (p) { return p.id !== id; });
    saveState();
    renderCatalog();
  }

  // ---------- invoice modal ----------

  var draftItems = [];

  function blankItem() {
    return { catalogId: '', description: '', qty: 1, unit: '', price: 0 };
  }

  var activeItemIndex = null;

  function itemEditorHTML(item, cls) {
    item = item || blankItem();
    var options = '<option value="">Personalizado</option>' + state.products.map(function (p) {
      return '<option value="' + p.id + '"' + (item.catalogId === p.id ? ' selected' : '') + '>' + escapeHTML(p.name) + '</option>';
    }).join('');
    return '<div class="item-editor-card">' +
      '<select class="' + cls + '-catalog">' + options + '</select>' +
      '<input type="text" class="' + cls + '-desc" placeholder="Descripción" value="' + escapeHTML(item.description) + '">' +
      '<div class="ie-row">' +
      '<input type="number" class="' + cls + '-qty" min="0" step="0.01" placeholder="Cant." value="' + item.qty + '">' +
      '<input type="text" class="' + cls + '-unit" placeholder="Unidad" value="' + escapeHTML(item.unit || '') + '">' +
      '<input type="number" class="' + cls + '-price" min="0" step="0.01" placeholder="Precio" value="' + item.price + '">' +
      '</div>' +
      '<div class="ie-actions">' +
      '<button type="button" class="btn-small" id="' + cls + '-editor-cancel">Cancelar</button>' +
      '<button type="button" class="ie-save-btn" id="' + cls + '-editor-save">Guardar concepto</button>' +
      '</div></div>';
  }

  function itemRowHTML(item, idx) {
    return '<div class="item-row" data-edit-item="' + idx + '">' +
      '<div class="item-row-main"><div class="item-row-desc">' + escapeHTML(item.description) + '</div>' +
      '<div class="item-row-sub">' + item.qty + (item.unit ? ' ' + escapeHTML(item.unit) : '') + ' × ' + money(item.price) + '</div></div>' +
      '<div class="item-row-amount">' + money((Number(item.qty) || 0) * (Number(item.price) || 0)) + '</div>' +
      '<button type="button" class="item-row-delete" data-remove-item="' + idx + '" aria-label="Eliminar concepto">' + TRASH_SVG + '</button>' +
      '</div>';
  }

  function openInvoiceModal(invoice) {
    var isEdit = !!invoice;
    if (!state.clients.length) {
      toast('Primero agrega al menos un cliente.');
      return;
    }
    draftItems = isEdit ? invoice.items.map(function (it) { return Object.assign({}, it); }) : [];
    activeItemIndex = null;
    var issueDate = isEdit ? invoice.issueDate : todayISO();
    var dueDate = isEdit ? invoice.dueDate : addDaysISO(issueDate, state.settings.dueDays);
    var taxRate = isEdit ? invoice.taxRate : state.settings.taxRate;
    var clientId = isEdit ? invoice.clientId : state.clients[0].id;

    var html = navBarHTML(isEdit ? escapeHTML(invoice.number) : 'Nueva factura', 'invoice-form') +
      '<form id="invoice-form">' +
      '<div class="form-grid" style="max-width:none;">' +
      '<label>Cliente<select name="clientId" class="select-pill">' + state.clients.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === clientId ? ' selected' : '') + '>' + escapeHTML(c.name) + '</option>';
      }).join('') + '</select></label>' +
      '<div class="field-row-3">' +
      '<label style="flex:1;">Emitida<input type="date" name="issueDate" value="' + issueDate + '"></label>' +
      '<label style="flex:1;">Vence<input type="date" name="dueDate" value="' + dueDate + '"></label>' +
      '<label style="flex:1;">Sales tax %<input type="number" name="taxRate" min="0" max="100" step="0.001" value="' + taxRate + '"></label>' +
      '</div></div>' +
      '<div class="modal-section"><h3>Conceptos</h3>' +
      '<div class="item-list" id="item-list"></div>' +
      '<div id="item-editor"></div>' +
      '<button type="button" class="btn-pill" id="add-item-btn">+ Agregar concepto</button>' +
      '<div class="totals-block" id="totals-block"></div>' +
      '</div>';

    if (isEdit) {
      html += '<div class="modal-section"><h3>Pagos</h3>' +
        '<div class="payments-list" id="payments-list"></div>' +
        '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">' +
        '<label style="font-size:12px;font-weight:600;color:var(--ink-soft);">Fecha<input type="date" id="payment-date" value="' + todayISO() + '" style="display:block;padding:9px 10px;border:none;border-radius:9px;background:var(--fill);"></label>' +
        '<label style="font-size:12px;font-weight:600;color:var(--ink-soft);">Monto<input type="number" id="payment-amount" min="0" step="0.01" style="display:block;padding:9px 10px;border:none;border-radius:9px;background:var(--fill);width:110px;"></label>' +
        '<label style="font-size:12px;font-weight:600;color:var(--ink-soft);">Método<select id="payment-method" style="display:block;padding:9px 10px;border:none;border-radius:9px;background:var(--fill);">' +
        PAYMENT_METHODS.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('') + '</select></label>' +
        '<button type="button" class="btn-small" id="add-payment-btn" style="color:var(--accent);font-weight:600;background:none;border:none;cursor:pointer;">+ Registrar pago</button>' +
        '</div>' +
        '<div class="balance-line" id="balance-line"></div>' +
        '</div>';
    }

    if (isEdit) {
      html += '<div class="action-list">' +
        '<button type="button" id="download-pdf-btn">Descargar PDF</button>' +
        '<button type="button" id="send-email-btn">Enviar por correo</button>' +
        '<button type="button" class="action-destructive" id="delete-invoice-btn">Eliminar factura</button>' +
        '</div>';
    }
    html += '</form>';

    openModal(html);

    var form = document.getElementById('invoice-form');

    function renderItemList() {
      var el = document.getElementById('item-list');
      el.innerHTML = draftItems.length
        ? draftItems.map(function (item, idx) { return itemRowHTML(item, idx); }).join('')
        : '<p class="field-hint">Aún no agregas ningún concepto.</p>';
      renderTotals();
    }

    function renderItemEditor() {
      var el = document.getElementById('item-editor');
      if (activeItemIndex === null) { el.innerHTML = ''; return; }
      var item = activeItemIndex === 'new' ? null : draftItems[activeItemIndex];
      el.innerHTML = itemEditorHTML(item, 'ie');
    }

    function renderTotals() {
      var subtotal = draftItems.reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
      var rate = Number(form.taxRate.value) || 0;
      var tax = subtotal * rate / 100;
      document.getElementById('totals-block').innerHTML =
        '<div class="totals-row"><span>Subtotal</span><span>' + money(subtotal) + '</span></div>' +
        '<div class="totals-row"><span>Sales tax (' + rate + '%)</span><span>' + money(tax) + '</span></div>' +
        '<div class="totals-row grand"><span>Total</span><span>' + money(subtotal + tax) + '</span></div>';
    }

    function renderPaymentsSection() {
      if (!isEdit) return;
      var list = document.getElementById('payments-list');
      var payments = invoice.payments || [];
      list.innerHTML = payments.length ? payments.map(function (p, idx) {
        return '<div class="payment-row"><span>' + fmtDate(p.date) + ' · ' + escapeHTML(p.method) + '</span>' +
          '<span>' + money(p.amount) + ' <button type="button" class="btn-icon" data-remove-payment="' + idx + '" aria-label="Quitar pago">' + TRASH_SVG + '</button></span></div>';
      }).join('') : '<p class="field-hint">Sin pagos registrados todavía.</p>';
      var subtotal = draftItems.reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
      var rate = Number(form.taxRate.value) || 0;
      var total = subtotal + subtotal * rate / 100;
      var paid = payments.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
      var balance = Math.max(0, Math.round((total - paid) * 100) / 100);
      var line = document.getElementById('balance-line');
      line.className = 'balance-line ' + (balance <= 0.004 ? 'settled' : 'owed');
      line.innerHTML = '<span>Saldo pendiente</span><span>' + money(balance) + '</span>';
      document.getElementById('payment-amount').value = balance > 0 ? balance : '';
    }

    renderItemList();
    renderPaymentsSection();

    form.addEventListener('input', function (e) {
      if (e.target.name === 'taxRate') { renderTotals(); renderPaymentsSection(); }
    });

    form.addEventListener('change', function (e) {
      if (e.target.classList.contains('ie-catalog')) {
        var pid = e.target.value;
        var editorEl = document.getElementById('item-editor');
        if (pid) {
          var p = getProduct(pid);
          if (p) {
            editorEl.querySelector('.ie-desc').value = p.description || p.name;
            editorEl.querySelector('.ie-price').value = p.price;
            editorEl.querySelector('.ie-unit').value = p.unit || '';
          }
        }
      }
    });

    document.getElementById('add-item-btn').addEventListener('click', function () {
      activeItemIndex = 'new';
      renderItemEditor();
    });

    form.addEventListener('click', function (e) {
      var delBtn = e.target.closest('[data-remove-item]');
      if (delBtn) {
        var delIdx = Number(delBtn.dataset.removeItem);
        draftItems.splice(delIdx, 1);
        if (activeItemIndex === delIdx) activeItemIndex = null;
        renderItemList();
        renderItemEditor();
        renderPaymentsSection();
        return;
      }
      var editBtn = e.target.closest('[data-edit-item]');
      if (editBtn) {
        activeItemIndex = Number(editBtn.dataset.editItem);
        renderItemEditor();
        return;
      }
      if (e.target.id === 'ie-editor-cancel') {
        activeItemIndex = null;
        renderItemEditor();
        return;
      }
      if (e.target.id === 'ie-editor-save') {
        var editorEl = document.getElementById('item-editor');
        var newItem = {
          catalogId: editorEl.querySelector('.ie-catalog').value || '',
          description: editorEl.querySelector('.ie-desc').value.trim(),
          qty: Number(editorEl.querySelector('.ie-qty').value) || 0,
          unit: editorEl.querySelector('.ie-unit').value.trim(),
          price: Number(editorEl.querySelector('.ie-price').value) || 0
        };
        if (!newItem.description || newItem.qty <= 0) { toast('Ponle una descripción y una cantidad mayor a 0.'); return; }
        if (activeItemIndex === 'new') draftItems.push(newItem);
        else draftItems[activeItemIndex] = newItem;
        activeItemIndex = null;
        renderItemList();
        renderItemEditor();
        renderPaymentsSection();
        return;
      }
      var pidx = e.target.dataset.removePayment;
      if (pidx !== undefined) {
        invoice.payments.splice(Number(pidx), 1);
        saveState();
        renderPaymentsSection();
        renderView('invoices');
      }
    });

    if (isEdit) {
      document.getElementById('add-payment-btn').addEventListener('click', function () {
        var amount = Number(document.getElementById('payment-amount').value);
        if (!amount || amount <= 0) { toast('Ingresa un monto válido.'); return; }
        invoice.payments = invoice.payments || [];
        invoice.payments.push({ date: document.getElementById('payment-date').value || todayISO(), amount: amount, method: document.getElementById('payment-method').value });
        saveState();
        renderPaymentsSection();
        renderView('invoices');
        toast('Pago registrado.');
      });
      document.getElementById('download-pdf-btn').addEventListener('click', function () { downloadInvoicePDF(invoice); });
      document.getElementById('send-email-btn').addEventListener('click', function () { sendInvoiceEmail(invoice); });
      document.getElementById('delete-invoice-btn').addEventListener('click', function () {
        if (!confirm('¿Eliminar esta factura? Esta acción no se puede deshacer.')) return;
        state.invoices = state.invoices.filter(function (i) { return i.id !== invoice.id; });
        saveState();
        closeModal();
        renderView(currentViewFromHash());
        toast('Factura eliminada.');
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var items = draftItems
        .map(function (it) { return { catalogId: it.catalogId || '', description: (it.description || '').trim(), qty: Number(it.qty) || 0, unit: (it.unit || '').trim(), price: Number(it.price) || 0 }; })
        .filter(function (it) { return it.description && it.qty > 0; });
      if (!items.length) { toast('Agrega al menos un concepto válido.'); return; }
      var payload = {
        clientId: fd.get('clientId'),
        issueDate: fd.get('issueDate'),
        dueDate: fd.get('dueDate'),
        taxRate: Number(fd.get('taxRate')) || 0,
        items: items
      };
      if (isEdit) {
        Object.assign(invoice, payload);
      } else {
        payload.id = uid();
        payload.number = nextFolioPreview();
        payload.payments = [];
        state.settings.nextInvoiceNumber += 1;
        state.invoices.push(payload);
      }
      saveState();
      closeModal();
      renderView(currentViewFromHash());
      toast('Factura guardada.');
    });
  }

  // ---------- quote modal ----------

  var quoteDraftItems = [];

  function openQuoteModal(quote) {
    var isEdit = !!quote;
    if (!state.clients.length) {
      toast('Primero agrega al menos un cliente.');
      return;
    }
    quoteDraftItems = isEdit ? quote.items.map(function (it) { return Object.assign({}, it); }) : [];
    activeItemIndex = null;
    var issueDate = isEdit ? quote.issueDate : todayISO();
    var expiryDate = isEdit ? quote.expiryDate : addDaysISO(issueDate, 30);
    var taxRate = isEdit ? quote.taxRate : state.settings.taxRate;
    var clientId = isEdit ? quote.clientId : state.clients[0].id;
    var status = isEdit ? quote.status : 'draft';

    var html = navBarHTML(isEdit ? escapeHTML(quote.number) : 'Nueva cotización', 'quote-form');

    if (isEdit && quote.status === 'converted' && quote.convertedInvoiceId && getInvoice(quote.convertedInvoiceId)) {
      html += '<div class="convert-banner"><span>Ya se convirtió en la factura ' + escapeHTML(getInvoice(quote.convertedInvoiceId).number) + '.</span>' +
        '<button type="button" class="btn-small" id="open-converted-invoice-btn" style="color:var(--good);font-weight:700;background:none;border:none;cursor:pointer;">Ver factura</button></div>';
    }

    html += '<form id="quote-form">' +
      '<div class="form-grid" style="max-width:none;">' +
      '<label>Cliente<select name="clientId" class="select-pill">' + state.clients.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === clientId ? ' selected' : '') + '>' + escapeHTML(c.name) + '</option>';
      }).join('') + '</select></label>' +
      '<div class="field-row-3">' +
      '<label style="flex:1;">Emitida<input type="date" name="issueDate" value="' + issueDate + '"></label>' +
      '<label style="flex:1;">Vence<input type="date" name="expiryDate" value="' + expiryDate + '"></label>' +
      '<label style="flex:1;">Sales tax %<input type="number" name="taxRate" min="0" max="100" step="0.001" value="' + taxRate + '"></label>' +
      '</div>';
    if (isEdit) {
      html += '<label>Estado<select name="status">' +
        ['draft', 'sent', 'approved', 'declined'].map(function (s) {
          return '<option value="' + s + '"' + (status === s ? ' selected' : '') + '>' + quoteStatusLabel(s) + '</option>';
        }).join('') + '</select></label>';
    }
    html += '</div>' +
      '<div class="modal-section"><h3>Conceptos</h3>' +
      '<div class="item-list" id="quote-item-list"></div>' +
      '<div id="quote-item-editor"></div>' +
      '<button type="button" class="btn-pill" id="add-quote-item-btn">+ Agregar concepto</button>' +
      '<div class="totals-block" id="quote-totals-block"></div>' +
      '</div>';

    if (isEdit) {
      html += '<div class="action-list">' +
        '<button type="button" id="download-quote-pdf-btn">Descargar PDF</button>' +
        '<button type="button" id="send-quote-email-btn">Enviar por correo</button>';
      if (quote.status !== 'converted') html += '<button type="button" id="convert-quote-btn">Convertir a factura</button>';
      html += '<button type="button" class="action-destructive" id="delete-quote-btn">Eliminar cotización</button>' +
        '</div>';
    }
    html += '</form>';

    openModal(html);
    var form = document.getElementById('quote-form');

    function renderQuoteItemList() {
      var el = document.getElementById('quote-item-list');
      el.innerHTML = quoteDraftItems.length
        ? quoteDraftItems.map(function (item, idx) { return itemRowHTML(item, idx); }).join('')
        : '<p class="field-hint">Aún no agregas ningún concepto.</p>';
      renderQuoteTotals();
    }

    function renderQuoteItemEditor() {
      var el = document.getElementById('quote-item-editor');
      if (activeItemIndex === null) { el.innerHTML = ''; return; }
      var item = activeItemIndex === 'new' ? null : quoteDraftItems[activeItemIndex];
      el.innerHTML = itemEditorHTML(item, 'qie');
    }

    function renderQuoteTotals() {
      var subtotal = quoteDraftItems.reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
      var rate = Number(form.taxRate.value) || 0;
      var tax = subtotal * rate / 100;
      document.getElementById('quote-totals-block').innerHTML =
        '<div class="totals-row"><span>Subtotal</span><span>' + money(subtotal) + '</span></div>' +
        '<div class="totals-row"><span>Sales tax (' + rate + '%)</span><span>' + money(tax) + '</span></div>' +
        '<div class="totals-row grand"><span>Total</span><span>' + money(subtotal + tax) + '</span></div>';
    }

    renderQuoteItemList();

    form.addEventListener('input', function (e) {
      if (e.target.name === 'taxRate') renderQuoteTotals();
    });

    form.addEventListener('change', function (e) {
      if (e.target.classList.contains('qie-catalog')) {
        var pid = e.target.value;
        var editorEl = document.getElementById('quote-item-editor');
        if (pid) {
          var p = getProduct(pid);
          if (p) {
            editorEl.querySelector('.qie-desc').value = p.description || p.name;
            editorEl.querySelector('.qie-price').value = p.price;
            editorEl.querySelector('.qie-unit').value = p.unit || '';
          }
        }
      }
    });

    document.getElementById('add-quote-item-btn').addEventListener('click', function () {
      activeItemIndex = 'new';
      renderQuoteItemEditor();
    });

    form.addEventListener('click', function (e) {
      var delBtn = e.target.closest('[data-remove-item]');
      if (delBtn) {
        var delIdx = Number(delBtn.dataset.removeItem);
        quoteDraftItems.splice(delIdx, 1);
        if (activeItemIndex === delIdx) activeItemIndex = null;
        renderQuoteItemList();
        renderQuoteItemEditor();
        return;
      }
      var editBtn = e.target.closest('[data-edit-item]');
      if (editBtn) {
        activeItemIndex = Number(editBtn.dataset.editItem);
        renderQuoteItemEditor();
        return;
      }
      if (e.target.id === 'qie-editor-cancel') {
        activeItemIndex = null;
        renderQuoteItemEditor();
        return;
      }
      if (e.target.id === 'qie-editor-save') {
        var editorEl = document.getElementById('quote-item-editor');
        var newItem = {
          catalogId: editorEl.querySelector('.qie-catalog').value || '',
          description: editorEl.querySelector('.qie-desc').value.trim(),
          qty: Number(editorEl.querySelector('.qie-qty').value) || 0,
          unit: editorEl.querySelector('.qie-unit').value.trim(),
          price: Number(editorEl.querySelector('.qie-price').value) || 0
        };
        if (!newItem.description || newItem.qty <= 0) { toast('Ponle una descripción y una cantidad mayor a 0.'); return; }
        if (activeItemIndex === 'new') quoteDraftItems.push(newItem);
        else quoteDraftItems[activeItemIndex] = newItem;
        activeItemIndex = null;
        renderQuoteItemList();
        renderQuoteItemEditor();
        return;
      }
    });

    if (isEdit) {
      document.getElementById('download-quote-pdf-btn').addEventListener('click', function () { downloadQuotePDF(quote); });
      document.getElementById('send-quote-email-btn').addEventListener('click', function () { sendQuoteEmail(quote); });
      var convertBtn = document.getElementById('convert-quote-btn');
      if (convertBtn) convertBtn.addEventListener('click', function () { convertQuoteToInvoice(quote); });
      var openConvertedBtn = document.getElementById('open-converted-invoice-btn');
      if (openConvertedBtn) openConvertedBtn.addEventListener('click', function () { closeModal(); openInvoiceModal(getInvoice(quote.convertedInvoiceId)); });
      document.getElementById('delete-quote-btn').addEventListener('click', function () {
        if (!confirm('¿Eliminar esta cotización?')) return;
        state.quotes = state.quotes.filter(function (q) { return q.id !== quote.id; });
        saveState();
        closeModal();
        renderView(currentViewFromHash());
        toast('Cotización eliminada.');
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var items = quoteDraftItems
        .map(function (it) { return { catalogId: it.catalogId || '', description: (it.description || '').trim(), qty: Number(it.qty) || 0, unit: (it.unit || '').trim(), price: Number(it.price) || 0 }; })
        .filter(function (it) { return it.description && it.qty > 0; });
      if (!items.length) { toast('Agrega al menos un concepto válido.'); return; }
      var payload = {
        clientId: fd.get('clientId'),
        issueDate: fd.get('issueDate'),
        expiryDate: fd.get('expiryDate'),
        taxRate: Number(fd.get('taxRate')) || 0,
        items: items
      };
      if (isEdit) {
        payload.status = fd.get('status') || quote.status;
        Object.assign(quote, payload);
      } else {
        payload.id = uid();
        payload.number = nextQuotePreview();
        payload.status = 'draft';
        state.settings.nextQuoteNumber += 1;
        state.quotes.push(payload);
      }
      saveState();
      closeModal();
      renderView(currentViewFromHash());
      toast('Cotización guardada.');
    });
  }

  function convertQuoteToInvoice(quote) {
    if (quote.status === 'converted') { toast('Esta cotización ya fue convertida.'); return; }
    if (!confirm('¿Convertir esta cotización en una factura nueva?')) return;
    var issueDate = todayISO();
    var invoice = {
      id: uid(),
      number: nextFolioPreview(),
      clientId: quote.clientId,
      issueDate: issueDate,
      dueDate: addDaysISO(issueDate, state.settings.dueDays),
      taxRate: quote.taxRate,
      items: quote.items.map(function (it) { return Object.assign({}, it); }),
      payments: []
    };
    state.settings.nextInvoiceNumber += 1;
    state.invoices.push(invoice);
    quote.status = 'converted';
    quote.convertedInvoiceId = invoice.id;
    saveState();
    closeModal();
    renderView(currentViewFromHash());
    toast('Factura ' + invoice.number + ' creada a partir de la cotización.');
  }

  function downloadQuotePDF(q) {
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { toast('No se pudo generar el PDF.'); return; }
    var doc = new jsPDFCtor({ unit: 'pt', format: 'letter' });
    var c = getClient(q.clientId);
    var s = state.settings;
    var marginX = 40;
    var y = 50;

    if (s.logo) {
      try { doc.addImage(s.logo, 'PNG', marginX, y - 10, 42, 42); } catch (e) {}
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(s.companyName || 'Company', s.logo ? marginX + 54 : marginX, y + 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    if (s.ein) doc.text('EIN: ' + s.ein, s.logo ? marginX + 54 : marginX, y + 26);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
    doc.text('ESTIMATE', 555, y + 10, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Estimate #: ' + q.number, 555, y + 30, { align: 'right' });
    doc.text('Issued: ' + fmtDateEN(q.issueDate), 555, y + 44, { align: 'right' });
    doc.text('Valid until: ' + fmtDateEN(q.expiryDate), 555, y + 58, { align: 'right' });

    y += 80;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Prepared For', marginX, y);
    doc.setFont('helvetica', 'normal');
    var lines = [c ? c.name : ''];
    if (c && c.address) lines.push(c.address);
    if (c && c.email) lines.push(c.email);
    lines.forEach(function (line, i) { doc.text(line, marginX, y + 16 + i * 14); });

    y += 16 + lines.length * 14 + 20;

    var body = q.items.map(function (it) {
      return [it.description, String(it.qty), it.unit || '', money(it.price), money(it.qty * it.price)];
    });
    doc.autoTable({
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [['Description', 'Qty', 'Unit', 'Rate', 'Amount']],
      body: body,
      styles: { font: 'helvetica', fontSize: 10 },
      headStyles: { fillColor: [28, 27, 24] }
    });

    var afterTableY = doc.lastAutoTable.finalY + 20;
    var subtotal = quoteSubtotal(q), tax = quoteTaxAmount(q), total = quoteTotal(q);
    var rows = [
      ['Subtotal', money(subtotal)],
      ['Sales tax (' + q.taxRate + '%)', money(tax)],
      ['Total', money(total)]
    ];
    doc.setFontSize(10);
    rows.forEach(function (r, i) {
      var rowY = afterTableY + i * 16;
      doc.setFont('helvetica', r[0] === 'Total' ? 'bold' : 'normal');
      doc.text(r[0], 420, rowY);
      doc.text(r[1], 555, rowY, { align: 'right' });
    });

    doc.save(q.number + '.pdf');
  }

  // ---------- pdf ----------

  function downloadInvoicePDF(inv) {
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { toast('No se pudo generar el PDF.'); return; }
    var doc = new jsPDFCtor({ unit: 'pt', format: 'letter' });
    var c = getClient(inv.clientId);
    var s = state.settings;
    var marginX = 40;
    var y = 50;

    if (s.logo) {
      try { doc.addImage(s.logo, 'PNG', marginX, y - 10, 42, 42); } catch (e) {}
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(s.companyName || 'Company', s.logo ? marginX + 54 : marginX, y + 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    if (s.ein) doc.text('EIN: ' + s.ein, s.logo ? marginX + 54 : marginX, y + 26);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
    doc.text('INVOICE', 555, y + 10, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Invoice #: ' + inv.number, 555, y + 30, { align: 'right' });
    doc.text('Issued: ' + fmtDateEN(inv.issueDate), 555, y + 44, { align: 'right' });
    doc.text('Due: ' + fmtDateEN(inv.dueDate), 555, y + 58, { align: 'right' });

    y += 80;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Bill To', marginX, y);
    doc.setFont('helvetica', 'normal');
    var lines = [c ? c.name : ''];
    if (c && c.address) lines.push(c.address);
    if (c && c.email) lines.push(c.email);
    if (c && c.taxId) lines.push('Tax ID: ' + c.taxId);
    lines.forEach(function (line, i) { doc.text(line, marginX, y + 16 + i * 14); });

    y += 16 + lines.length * 14 + 20;

    var body = inv.items.map(function (it) {
      return [it.description, String(it.qty), it.unit || '', money(it.price), money(it.qty * it.price)];
    });
    doc.autoTable({
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [['Description', 'Qty', 'Unit', 'Rate', 'Amount']],
      body: body,
      styles: { font: 'helvetica', fontSize: 10 },
      headStyles: { fillColor: [28, 27, 24] }
    });

    var afterTableY = doc.lastAutoTable.finalY + 20;
    var subtotal = invoiceSubtotal(inv), tax = invoiceTaxAmount(inv), total = invoiceTotal(inv), balance = invoiceBalance(inv);
    var rows = [
      ['Subtotal', money(subtotal)],
      ['Sales tax (' + inv.taxRate + '%)', money(tax)],
      ['Total', money(total)]
    ];
    if (invoicePaid(inv) > 0) rows.push(['Balance due', money(balance)]);
    doc.setFontSize(10);
    rows.forEach(function (r, i) {
      var rowY = afterTableY + i * 16;
      doc.setFont('helvetica', i === rows.length - 1 || r[0] === 'Total' ? 'bold' : 'normal');
      doc.text(r[0], 420, rowY);
      doc.text(r[1], 555, rowY, { align: 'right' });
    });

    if (s.paymentLink) {
      var payY = afterTableY + rows.length * 16 + 22;
      doc.setFont('helvetica', 'bold'); doc.setTextColor(181, 80, 46);
      doc.textWithLink('Pay online →', marginX, payY, { url: s.paymentLink });
      doc.setTextColor(0, 0, 0);
    }

    doc.save(inv.number + '.pdf');
  }

  function fmtDateEN(iso) { return fmtDate(iso); }

  function sendInvoiceEmail(inv) {
    var c = getClient(inv.clientId);
    if (!c || !c.email) { toast('Este cliente no tiene correo guardado.'); return; }
    downloadInvoicePDF(inv);
    var balance = invoiceBalance(inv);
    var lines = [
      'Hi ' + c.name + ',',
      '',
      'Please find attached invoice ' + inv.number + ' for ' + money(invoiceTotal(inv)) + ', due ' + fmtDateEN(inv.dueDate) + '.',
      balance > 0 ? 'Balance due: ' + money(balance) + '.' : 'This invoice is fully paid — thank you!'
    ];
    if (state.settings.paymentLink && balance > 0) lines.push('You can pay online here: ' + state.settings.paymentLink);
    lines.push('', 'The PDF was just downloaded to your device — please attach it to this email before sending.', '', 'Thank you,', state.settings.companyName || '');
    openMailto(c.email, 'Invoice ' + inv.number + ' from ' + (state.settings.companyName || ''), lines.join('\n'));
  }

  function sendQuoteEmail(q) {
    var c = getClient(q.clientId);
    if (!c || !c.email) { toast('Este cliente no tiene correo guardado.'); return; }
    downloadQuotePDF(q);
    var lines = [
      'Hi ' + c.name + ',',
      '',
      'Please find attached estimate ' + q.number + ' for ' + money(quoteTotal(q)) + ', valid until ' + fmtDateEN(q.expiryDate) + '.',
      '',
      'The PDF was just downloaded to your device — please attach it to this email before sending.',
      '',
      'Thank you,',
      state.settings.companyName || ''
    ];
    openMailto(c.email, 'Estimate ' + q.number + ' from ' + (state.settings.companyName || ''), lines.join('\n'));
  }

  // ---------- onboarding ----------

  function needsOnboarding() { return !state.onboarded; }

  function openOnboarding() {
    var s = state.settings;
    var logoPreview = s.logo ? '<img src="' + s.logo + '" alt="" style="width:64px;height:64px;object-fit:contain;border-radius:14px;margin:0 auto 4px;display:block;">' : '';
    openModal(
      '<div class="modal-header simple">' + logoPreview + '<h2>Bienvenido</h2></div>' +
      '<p class="field-hint" style="text-align:center;">Ya dejamos tu compañía y tu logo listos. Confirma o ajusta estos datos para empezar — lo demás lo cambias luego en Ajustes.</p>' +
      '<form id="onboarding-form" class="form-grid" style="max-width:none;margin-top:8px;">' +
      '<label>Nombre de la compañía<input type="text" name="companyName" required value="' + escapeHTML(s.companyName) + '"></label>' +
      '<label>EIN / Tax ID (opcional)<input type="text" name="ein" placeholder="12-3456789" value="' + escapeHTML(s.ein) + '"></label>' +
      '<label>Tasa de sales tax por defecto (%)<input type="number" name="taxRate" min="0" max="100" step="0.001" value="' + s.taxRate + '" required></label>' +
      '<button type="submit" class="btn-pill" style="margin-top:8px;">Empezar</button>' +
      '</form>'
    );
    document.querySelector('.modal-overlay').style.pointerEvents = 'auto';
    document.getElementById('onboarding-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      state.settings.companyName = fd.get('companyName').trim();
      state.settings.ein = fd.get('ein').trim();
      state.settings.taxRate = Number(fd.get('taxRate')) || 0;
      state.onboarded = true;
      saveState();
      closeModal();
      applyBrand();
      renderView(currentViewFromHash());
    });
  }

  // ---------- global event wiring ----------

  function wireEvents() {
    document.getElementById('sidenav').addEventListener('click', function (e) {
      var a = e.target.closest('a[data-view]');
      if (a) { location.hash = a.dataset.view; }
    });
    document.getElementById('bottombar').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]');
      if (b) { location.hash = b.dataset.view; }
    });
    document.getElementById('more-tab-btn').addEventListener('click', openMoreSheet);
    window.addEventListener('hashchange', function () { setView(currentViewFromHash()); });

    document.getElementById('new-invoice-btn').addEventListener('click', function () { openInvoiceModal(null); });
    document.getElementById('new-quote-btn').addEventListener('click', function () { openQuoteModal(null); });
    document.getElementById('new-client-btn').addEventListener('click', function () { openClientModal(null); });
    document.getElementById('new-product-btn').addEventListener('click', function () { openProductModal(null); });

    document.getElementById('views').addEventListener('click', function (e) {
      var invRow = e.target.closest('[data-open-invoice]');
      var delInv = e.target.closest('[data-delete-invoice]');
      var quoteRow = e.target.closest('[data-open-quote]');
      var delQuote = e.target.closest('[data-delete-quote]');
      var cliRow = e.target.closest('[data-open-client]');
      var delCli = e.target.closest('[data-delete-client]');
      var prodRow = e.target.closest('[data-open-product]');
      var delProd = e.target.closest('[data-delete-product]');
      if (delInv) {
        e.stopPropagation();
        if (confirm('¿Eliminar esta factura?')) {
          state.invoices = state.invoices.filter(function (i) { return i.id !== delInv.dataset.deleteInvoice; });
          saveState();
          renderView(currentViewFromHash());
        }
        return;
      }
      if (delQuote) {
        e.stopPropagation();
        if (confirm('¿Eliminar esta cotización?')) {
          state.quotes = state.quotes.filter(function (q) { return q.id !== delQuote.dataset.deleteQuote; });
          saveState();
          renderView(currentViewFromHash());
        }
        return;
      }
      if (delCli) { e.stopPropagation(); deleteClient(delCli.dataset.deleteClient); return; }
      if (delProd) { e.stopPropagation(); deleteProduct(delProd.dataset.deleteProduct); return; }
      if (invRow) { openInvoiceModal(getInvoice(invRow.dataset.openInvoice)); return; }
      if (quoteRow) { openQuoteModal(getQuote(quoteRow.dataset.openQuote)); return; }
      if (cliRow) { openClientModal(getClient(cliRow.dataset.openClient)); return; }
      if (prodRow) { openProductModal(getProduct(prodRow.dataset.openProduct)); return; }
    });

    document.getElementById('modal-root').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) { closeModal(); return; }
      var invRow = e.target.closest('[data-open-invoice]');
      var qRow = e.target.closest('[data-open-quote]');
      if (invRow) { closeModal(); openInvoiceModal(getInvoice(invRow.dataset.openInvoice)); }
      else if (qRow) { closeModal(); openQuoteModal(getQuote(qRow.dataset.openQuote)); }
    });

    document.getElementById('invoice-search').addEventListener('input', function (e) { invoiceFilters.search = e.target.value; renderInvoices(); });
    document.getElementById('invoice-status-filter').addEventListener('change', function (e) { invoiceFilters.status = e.target.value; renderInvoices(); });
    document.getElementById('invoice-from').addEventListener('change', function (e) { invoiceFilters.from = e.target.value; renderInvoices(); });
    document.getElementById('invoice-to').addEventListener('change', function (e) { invoiceFilters.to = e.target.value; renderInvoices(); });
    document.getElementById('invoice-filter-clear').addEventListener('click', function () {
      invoiceFilters = { search: '', status: 'all', from: '', to: '' };
      document.getElementById('invoice-search').value = '';
      document.getElementById('invoice-status-filter').value = 'all';
      document.getElementById('invoice-from').value = '';
      document.getElementById('invoice-to').value = '';
      renderInvoices();
    });

    document.getElementById('quote-search').addEventListener('input', function (e) { quoteFilters.search = e.target.value; renderQuotes(); });
    document.getElementById('quote-status-filter').addEventListener('change', function (e) { quoteFilters.status = e.target.value; renderQuotes(); });

    document.getElementById('client-search').addEventListener('input', function (e) { clientFilter = e.target.value; renderClients(); });
    document.getElementById('product-search').addEventListener('input', function (e) { productFilter = e.target.value; renderCatalog(); });
    document.getElementById('payment-search').addEventListener('input', function (e) { paymentFilters.search = e.target.value; renderPayments(); });
    document.getElementById('payment-from').addEventListener('change', function (e) { paymentFilters.from = e.target.value; renderPayments(); });
    document.getElementById('payment-to').addEventListener('change', function (e) { paymentFilters.to = e.target.value; renderPayments(); });

    var exportBtn = document.getElementById('export-invoices-btn');
    var exportMenu = document.getElementById('export-invoices-menu');
    exportBtn.addEventListener('click', function (e) { e.stopPropagation(); exportMenu.classList.toggle('open'); });
    document.addEventListener('click', function () { exportMenu.classList.remove('open'); });
    exportMenu.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-format]');
      if (btn) { exportInvoices(btn.dataset.format); exportMenu.classList.remove('open'); }
    });

    document.getElementById('settings-company-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      state.settings.companyName = fd.get('companyName').trim();
      state.settings.ein = fd.get('ein').trim();
      var file = fd.get('logo');
      var finish = function () { saveState(); applyBrand(); renderSettings(); toast('Compañía guardada.'); };
      if (file && file.size) {
        readImageAsResizedDataURL(file, 240).then(function (dataUrl) { state.settings.logo = dataUrl; finish(); });
      } else finish();
    });
    document.getElementById('logo-remove-btn').addEventListener('click', function () {
      state.settings.logo = null;
      saveState(); applyBrand(); renderSettings();
    });

    document.getElementById('settings-invoicing-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      state.settings.taxRate = Number(fd.get('taxRate')) || 0;
      state.settings.dueDays = Number(fd.get('dueDays')) || 0;
      state.settings.invoicePrefix = fd.get('invoicePrefix').trim() || 'INV-';
      state.settings.nextInvoiceNumber = Math.max(1, Number(fd.get('nextInvoiceNumber')) || 1);
      saveState();
      renderSettings();
      toast('Facturación guardada.');
    });

    document.getElementById('settings-payment-form').addEventListener('submit', function (e) {
      e.preventDefault();
      state.settings.paymentLink = new FormData(this).get('paymentLink').trim();
      saveState();
      toast('Link de pago guardado.');
    });

    document.getElementById('settings-quotes-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(this);
      state.settings.quotePrefix = fd.get('quotePrefix').trim() || 'EST-';
      state.settings.nextQuoteNumber = Math.max(1, Number(fd.get('nextQuoteNumber')) || 1);
      saveState();
      renderSettings();
      toast('Cotizaciones guardado.');
    });

    document.getElementById('settings-backup-form').addEventListener('submit', function (e) {
      e.preventDefault();
      state.settings.backupReminderDays = Math.max(1, Number(new FormData(this).get('backupReminderDays')) || 14);
      saveState();
      updateBackupBanner();
      toast('Guardado.');
    });

    document.getElementById('export-backup-btn').addEventListener('click', exportBackup);
    document.getElementById('import-backup-input').addEventListener('change', function (e) {
      if (e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('backup-banner-btn').addEventListener('click', exportBackup);
    document.getElementById('backup-banner-dismiss').addEventListener('click', function () {
      state.bannerDismissedAt = Date.now();
      saveState();
      updateBackupBanner();
    });

    document.getElementById('reset-data-btn').addEventListener('click', function () {
      if (!confirm('Esto borra TODOS los datos de este navegador. ¿Seguro que quieres continuar?')) return;
      if (!confirm('Última confirmación: esta acción no se puede deshacer. ¿Borrar todo?')) return;
      state = defaultState();
      saveState();
      applyBrand();
      renderView(currentViewFromHash());
      updateBackupBanner();
      openOnboarding();
    });
  }

  // ---------- init ----------

  function init() {
    applyBrand();
    wireEvents();
    setView(currentViewFromHash());
    updateBackupBanner();
    if (needsOnboarding()) openOnboarding();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
