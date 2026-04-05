/**
 * Prometheus i18n — Bilingual support (Thai / English)
 * Used by: company.html, overview.html, index.html
 *
 * Usage:
 *   t('key')         → returns translated string for currentLang
 *   setLang('en')    → switch language, saves to localStorage, re-renders page
 *   window.currentLang → 'th' | 'en'
 */

window.currentLang = localStorage.getItem('prometheus-lang') || 'th';

const _I18N = {
  th: {
    /* ── NAV ── */
    'nav.back':             '← กลับหน้าหลัก',
    'nav.loading':          'กำลังโหลดข้อมูล...',
    'nav.deep_dive':        'Deep Dive',

    /* ── COMPANY META ── */
    'company.updated':      'อัพเดท',

    /* ── QUICK STATS ── */
    'qs.notes_sub':         'บันทึกทั้งหมด',
    'qs.quotes_sub':        'จาก Earnings Call',
    'qs.roadmap_sub':       'สิ่งที่ผู้บริหารพูด',
    'qs.delivery_concluded':'รายการที่สรุปแล้ว',
    'qs.delivery_none':     'ยังไม่มีรายการสรุป',

    /* ── TABS ── */
    'tab.overview':         '🔍 ภาพรวม',
    'tab.notes':            '📝 บันทึก',
    'tab.quotes':           '💬 คำพูด',
    'tab.roadmap':          '🗺️ แผนงาน',
    'tab.financials':       '📊 การเงิน',

    /* ── OVERVIEW PANEL ── */
    'ov.stock_price':       '📈 ราคาหุ้น',
    'ov.company_info':      '🏢 ข้อมูลบริษัท',
    'ov.about':             '🏢 เกี่ยวกับบริษัท',
    'ov.latest_fin':        '📊 ข้อมูลการเงินล่าสุด',
    'ov.latest_note':       '📝 บันทึกล่าสุด',
    'ov.empty_notice':      '💡 ยังไม่มีข้อมูล Deep Dive เต็มรูปแบบ — ใช้ skill <strong>prometheus:analyze-report</strong> เพื่อเพิ่ม segments, management, bull/bear thesis',
    'ov.moat':              '🏰 จุดแข็งทางการแข่งขัน (Moat)',
    'ov.segments':          '📊 รายได้แยกตามกลุ่มธุรกิจ',
    'ov.geography':         '🌍 รายได้แยกตามภูมิภาค',
    'ov.timeline':          '📅 ประวัติและเหตุการณ์สำคัญ',
    'ov.management':        '👔 ทีมผู้บริหาร',
    'ov.thesis':            '⚖️ วิเคราะห์การลงทุน (Bull vs Bear)',
    'ov.risks':             '⚠️ ความเสี่ยงสำคัญ (คลิกเพื่อดูรายละเอียด)',
    'ov.ownership':         '🏦 โครงสร้างผู้ถือหุ้น',
    'ov.corp_structure':    '🏗️ โครงสร้างกลุ่มบริษัทและบริษัทร่วม',

    /* ── SNAPSHOT LABELS ── */
    'snap.founded':         'ก่อตั้ง',
    'snap.hq':              'สำนักงานใหญ่',
    'snap.employees':       'พนักงาน',
    'snap.fiscal_year_end': 'สิ้นปีบัญชี',
    'snap.biz_model':       'รูปแบบธุรกิจ',
    'snap.competitive_pos': 'ตำแหน่งการแข่งขัน',

    /* ── OVERVIEW.HTML SECTION TITLES ── */
    'ov2.snapshot':         '🏢 ภาพรวมบริษัท',
    'ov2.biz_model':        '⚙️ Business Model & Moat',
    'ov2.segments':         '📦 รายได้แยกตามกลุ่มธุรกิจ',
    'ov2.geography':        '🌍 รายได้แยกตามภูมิภาค',
    'ov2.timeline':         '📅 ประวัติบริษัท',
    'ov2.management':       '👤 ทีมผู้บริหาร',
    'ov2.thesis':           '⚖️ วิเคราะห์การลงทุน',
    'ov2.risks':            '⚠️ ความเสี่ยงหลัก',
    'snap2.founded':        'FOUNDED',
    'snap2.hq':             'HEADQUARTERS',
    'snap2.employees':      'EMPLOYEES',
    'snap2.fiscal_year_end':'FISCAL YEAR END',

    /* ── TIMELINE TYPE LABELS ── */
    'tl_type.founding':     'ก่อตั้ง',
    'tl_type.merger':       'M&A',
    'tl_type.milestone':    'เหตุการณ์',
    'tl_type.project':      'โครงการ',
    'tl_type.financial':    'การเงิน',
    'tl_type.crisis':       'วิกฤต',
    'tl_type.product':      'ผลิตภัณฑ์',

    /* ── THESIS ── */
    'thesis.bull':          '🐂 Bull Case — เหตุผลในการถือ',
    'thesis.bear':          '🐻 Bear Case — ความเสี่ยงหลัก',
    'thesis2.bull':         '🐂 BULL CASE',
    'thesis2.bear':         '🐻 BEAR CASE',

    /* ── RISK SEVERITY ── */
    'sev.high':             'สูง',
    'sev.medium':           'กลาง',
    'sev.low':              'ต่ำ',
    'risk.mitigation':      'การรับมือ',
    'risk.mitigation2':     'MITIGATION',

    /* ── MANAGEMENT ── */
    'mgmt.since':           'ดำรงตำแหน่งตั้งแต่ปี',
    'mgmt.since2':          'ตั้งแต่',

    /* ── ROADMAP ── */
    'rm.summary.delivered': 'สำเร็จ ✅',
    'rm.summary.pending':   'รอดำเนินการ ⏳',
    'rm.summary.missed':    'พลาด ❌',
    'rm.summary.partial':   'บางส่วน ⚠️',
    'rm.timeline_chart':    '📅 แผนผัง Timeline',
    'rm.said_on':           '📅 พูดเมื่อ',
    'rm.outcome':           'ผลลัพธ์',

    /* ── STATUS LABELS (badges & filters) ── */
    'status.delivered':     '✅ สำเร็จ',
    'status.pending':       '⏳ รอดำเนินการ',
    'status.missed':        '❌ พลาด',
    'status.partial':       '⚠️ บางส่วน',
    'status.monitoring':    '👀 ติดตาม',

    /* ── FILTER BUTTONS ── */
    'filter.all':           'ทั้งหมด',
    'filter.tag_label':     'แท็ก:',
    'filter.clear':         '✕ ล้าง',

    /* ── FINANCIALS ── */
    'fin.tv_fundamentals':  '📊 ข้อมูลพื้นฐาน — TradingView Financials',
    'fin.sankey':           '🌊 Revenue Breakdown — Sankey Diagram',
    'fin.revenue_trend':    '📈 แนวโน้ม Revenue',
    'fin.table_title':      '📋 ตารางข้อมูลทางการเงิน',
    'fin.table_metric':     'รายการ',
    'fin.notes':            '📝 หมายเหตุ',
    'fin.docs':             '🔗 เอกสารทางการ',

    /* ── EMPTY STATES ── */
    'empty.notes':          'ยังไม่มีบันทึก — เพิ่มใน notes array ของ data.json',
    'empty.notes_tag':      'ไม่มี Note ที่มี tag #',
    'empty.quotes':         'ยังไม่มี quotes — เพิ่มใน quotes array ของ data.json',
    'empty.quotes_tag':     'ไม่มี Quote ที่มี tag #',
    'empty.financials':     'ยังไม่มีข้อมูลทางการเงิน — เพิ่มใน financials ของ data.json',
    'empty.items':          'ไม่มีรายการ',
    'empty.roadmap':        'ไม่มีข้อมูล roadmap',

    /* ── LOADING / ERRORS ── */
    'loading.timeline':     'กำลังสร้าง timeline...',
    'loading.chart':        'กำลังสร้างแผนผัง...',
    'loading.data':         'กำลังโหลดข้อมูล...',
    'error.no_ticker':      'ไม่พบ ticker ในลิงก์',
    'error.not_found':      'ไม่พบข้อมูล',
    'error.chart':          'ไม่สามารถแสดงแผนผังได้',
    'error.timeline':       'ไม่สามารถแสดง timeline ได้',

    /* ── QUOTE ── */
    'quote.th_label':       '🇹🇭 คำแปลภาษาไทย',

    /* ── SEGMENTS (overview.html) ── */
    'seg.segments_count':   'กลุ่มธุรกิจ',
  },

  en: {
    /* ── NAV ── */
    'nav.back':             '← Back',
    'nav.loading':          'Loading...',
    'nav.deep_dive':        'Deep Dive',

    /* ── COMPANY META ── */
    'company.updated':      'Updated',

    /* ── QUICK STATS ── */
    'qs.notes_sub':         'Total notes',
    'qs.quotes_sub':        'From Earnings Calls',
    'qs.roadmap_sub':       'Management commitments',
    'qs.delivery_concluded':'items concluded',
    'qs.delivery_none':     'No concluded items yet',

    /* ── TABS ── */
    'tab.overview':         '🔍 Overview',
    'tab.notes':            '📝 Notes',
    'tab.quotes':           '💬 Quotes',
    'tab.roadmap':          '🗺️ Roadmap',
    'tab.financials':       '📊 Financials',

    /* ── OVERVIEW PANEL ── */
    'ov.stock_price':       '📈 Stock Price',
    'ov.company_info':      '🏢 Company Info',
    'ov.about':             '🏢 About',
    'ov.latest_fin':        '📊 Latest Financials',
    'ov.latest_note':       '📝 Latest Note',
    'ov.empty_notice':      '💡 No Deep Dive data yet — use skill <strong>prometheus:analyze-report</strong> to add segments, management, bull/bear thesis',
    'ov.moat':              '🏰 Competitive Moat',
    'ov.segments':          '📊 Revenue by Segment',
    'ov.geography':         '🌍 Revenue by Geography',
    'ov.timeline':          '📅 Company Timeline',
    'ov.management':        '👔 Management Team',
    'ov.thesis':            '⚖️ Investment Thesis (Bull vs Bear)',
    'ov.risks':             '⚠️ Key Risks (click for details)',
    'ov.ownership':         '🏦 Ownership Structure',
    'ov.corp_structure':    '🏗️ Corporate Group Structure',

    /* ── SNAPSHOT LABELS ── */
    'snap.founded':         'Founded',
    'snap.hq':              'Headquarters',
    'snap.employees':       'Employees',
    'snap.fiscal_year_end': 'Fiscal Year End',
    'snap.biz_model':       'Business Model',
    'snap.competitive_pos': 'Competitive Position',

    /* ── OVERVIEW.HTML SECTION TITLES ── */
    'ov2.snapshot':         '🏢 Company Snapshot',
    'ov2.biz_model':        '⚙️ Business Model & Moat',
    'ov2.segments':         '📦 Revenue by Segment',
    'ov2.geography':        '🌍 Revenue by Geography',
    'ov2.timeline':         '📅 Company Timeline',
    'ov2.management':       '👤 Management Team',
    'ov2.thesis':           '⚖️ Investment Thesis',
    'ov2.risks':            '⚠️ Key Risks',
    'snap2.founded':        'FOUNDED',
    'snap2.hq':             'HEADQUARTERS',
    'snap2.employees':      'EMPLOYEES',
    'snap2.fiscal_year_end':'FISCAL YEAR END',

    /* ── TIMELINE TYPE LABELS ── */
    'tl_type.founding':     'Founding',
    'tl_type.merger':       'M&A',
    'tl_type.milestone':    'Milestone',
    'tl_type.project':      'Project',
    'tl_type.financial':    'Financial',
    'tl_type.crisis':       'Crisis',
    'tl_type.product':      'Product',

    /* ── THESIS ── */
    'thesis.bull':          '🐂 Bull Case — Reasons to hold',
    'thesis.bear':          '🐻 Bear Case — Key risks',
    'thesis2.bull':         '🐂 BULL CASE',
    'thesis2.bear':         '🐻 BEAR CASE',

    /* ── RISK SEVERITY ── */
    'sev.high':             'HIGH',
    'sev.medium':           'MED',
    'sev.low':              'LOW',
    'risk.mitigation':      'Mitigation',
    'risk.mitigation2':     'MITIGATION',

    /* ── MANAGEMENT ── */
    'mgmt.since':           'Since',
    'mgmt.since2':          'Since',

    /* ── ROADMAP ── */
    'rm.summary.delivered': '✅ Delivered',
    'rm.summary.pending':   '⏳ Pending',
    'rm.summary.missed':    '❌ Missed',
    'rm.summary.partial':   '⚠️ Partial',
    'rm.timeline_chart':    '📅 Timeline Chart',
    'rm.said_on':           '📅 Said on',
    'rm.outcome':           'Outcome',

    /* ── STATUS LABELS (badges & filters) ── */
    'status.delivered':     '✅ Delivered',
    'status.pending':       '⏳ Pending',
    'status.missed':        '❌ Missed',
    'status.partial':       '⚠️ Partial',
    'status.monitoring':    '👀 Monitoring',

    /* ── FILTER BUTTONS ── */
    'filter.all':           'All',
    'filter.tag_label':     'Tags:',
    'filter.clear':         '✕ Clear',

    /* ── FINANCIALS ── */
    'fin.tv_fundamentals':  '📊 Fundamentals — TradingView',
    'fin.sankey':           '🌊 Revenue Breakdown — Sankey',
    'fin.revenue_trend':    '📈 Revenue Trend',
    'fin.table_title':      '📋 Financial Data Table',
    'fin.table_metric':     'Metric',
    'fin.notes':            '📝 Notes',
    'fin.docs':             '🔗 Official Documents',

    /* ── EMPTY STATES ── */
    'empty.notes':          'No notes yet — add to the notes array in data.json',
    'empty.notes_tag':      'No notes with tag #',
    'empty.quotes':         'No quotes yet — add to the quotes array in data.json',
    'empty.quotes_tag':     'No quotes with tag #',
    'empty.financials':     'No financials yet — add to the financials section in data.json',
    'empty.items':          'No items',
    'empty.roadmap':        'No roadmap data',

    /* ── LOADING / ERRORS ── */
    'loading.timeline':     'Building timeline...',
    'loading.chart':        'Building chart...',
    'loading.data':         'Loading...',
    'error.no_ticker':      'No ticker found in URL',
    'error.not_found':      'Data not found',
    'error.chart':          'Could not render chart',
    'error.timeline':       'Could not render timeline',

    /* ── QUOTE ── */
    'quote.th_label':       '🇹🇭 Thai Translation',

    /* ── SEGMENTS (overview.html) ── */
    'seg.segments_count':   'segments',
  }
};

/**
 * Translate a key into the current language.
 * Falls back to 'th' then the key itself if not found.
 */
window.t = function(key) {
  return (_I18N[window.currentLang] && _I18N[window.currentLang][key])
      || (_I18N['th'] && _I18N['th'][key])
      || key;
};

/**
 * Switch language, persist to localStorage, re-render current page.
 */
window.setLang = function(lang) {
  window.currentLang = lang;
  localStorage.setItem('prometheus-lang', lang);
  document.documentElement.lang = lang;
  const btn = document.getElementById('lang-btn');
  if (btn) btn.textContent = lang === 'th' ? '🇹🇭' : '🇺🇸';
  if (typeof window.rerenderPage === 'function') window.rerenderPage();
};

/* Apply stored language on page load */
(function() {
  document.documentElement.lang = window.currentLang;
  // Update button after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      const btn = document.getElementById('lang-btn');
      if (btn) btn.textContent = window.currentLang === 'th' ? '🇹🇭' : '🇺🇸';
    });
  } else {
    const btn = document.getElementById('lang-btn');
    if (btn) btn.textContent = window.currentLang === 'th' ? '🇹🇭' : '🇺🇸';
  }
})();
