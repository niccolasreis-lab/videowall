import {productPages} from './content-utils.js';
import {renderTable} from './table-renderer.js';
import {imageUrl} from './table-templates.js';
function element(tag, text, parent, className = '') { const node = document.createElement(tag); node.textContent = text ?? ''; node.className = className; parent.append(node); return node; }
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
export function renderVirtual(item, container, onReady = () => {}, onError = () => {}) {
  const c = item.config || {};
  if(c.catalogUnavailable===true){element('p','Nenhum produto disponível',container);return;}
  if (item.kind === 'price_table' && renderTable(item,container)) return;
  if (['web', 'youtube'].includes(item.kind)) {
    const frame = document.createElement('iframe'); frame.title = item.name; frame.referrerPolicy = 'no-referrer'; frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation'); frame.allow = 'autoplay; fullscreen';
    frame.src = item.kind === 'youtube' ? `https://www.youtube-nocookie.com/embed/${c.videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${c.videoId}` : c.url;
    frame.onload = onReady; frame.onerror = () => onError('Não foi possível carregar o conteúdo incorporado.'); container.append(frame); return 'pending';
  }
  if (item.kind === 'product_image') { const image = document.createElement('img'); image.src = item.url; image.alt = c.title; container.append(image); return; }
  const appearance = `${c.rounded ? ' rounded' : ''}${c.gradient ? ' gradient' : ''}${c.hideHeader ? ' hide-header' : ''}`;
  const card = element('article', '', container, `content-card ${item.kind} layout-${c.layout || 'grid'} orientation-${c.orientation || 'horizontal'}${appearance}`); card.style.backgroundColor = c.background; card.style.color = c.color; card.style.fontFamily = c.font === 'serif' ? 'Georgia, serif' : c.font === 'mono' ? 'ui-monospace, monospace' : 'Inter, Segoe UI, sans-serif';
  for (const [property, key] of [['--poster-item-size','itemSize'],['--poster-price-size','priceSize'],['--poster-featured-item-size','featuredItemSize'],['--poster-featured-price-size','featuredPriceSize']]) {
    const size = Number(c[key]);
    if (Number.isInteger(size) && size >= 8 && size <= 200) card.style.setProperty(property, `${size}px`);
  }
  if (item.kind === 'poster') {
    const background = imageUrl(c.backgroundImage), logo = imageUrl(c.logoImage);
    if (background) {
      card.style.backgroundImage = 'linear-gradient(#0005,#0008),url("'+background+'")';
      card.style.backgroundSize = 'cover';
      card.style.backgroundPosition = 'center';
    }
    if (logo) {
      const image = element('img','',card,'poster-brand-logo');
      image.src=logo;
      image.alt='';
    }
  }
  if (item.kind === 'price_table' && c.tableTheme === 'market') card.classList.add('theme-market');
  if (!(item.kind === 'poster' && c.hideHeader)) element('h1', c.title || c.city || item.name, card);
  if(c.priceType&&c.priceType!=='normal')element('small',c.priceType==='club'?'Preço de clube':'Preço de oferta',card,'price-type-label');
  if (item.kind === 'poster') element('p', c.body, card);
  if (item.kind === 'offer') { if (c.oldPrice != null) element('del', money(c.oldPrice), card); element('strong', money(c.price)+(c.unit?' / '+c.unit:''), card, 'offer-price'); element('p', c.body, card); }
  if (item.kind === 'price_table' || item.kind === 'poster' && c.rows?.length) {
    const table = element('div', '', card, 'price-rows'); const rows = (c.rows || []).filter(row => row.active !== false && !row.catalogUnavailable);
    const unit = row => c.showUnit === false ? '' : row.unit ? ` / ${row.unit}` : '';
    const paint = selected => { table.replaceChildren(); for (const row of selected) { const line = element('div', '', table, 'price-row'); element('span', row.name+(item.kind==='price_table'&&c.priceFormat==='inline'?' =':''), line); element('strong', money(row.price) + unit(row), line); } };
    if (item.kind === 'price_table') {
      const pages = productPages(rows), pageCount = pages.length;
      const counter = element('small','',card,'table-page-counter'); let pageIndex = 0;
      const turnPage = () => {
        if (!card.isConnected) return;
        paint(pages[pageIndex] || []);
        counter.textContent = pageCount ? `Página ${pageIndex + 1} de ${pageCount} · ${rows.length} produtos` : 'Nenhum produto ativo';
        pageIndex = (pageIndex + 1) % Math.max(1,pageCount);
        if (pageCount > 1) setTimeout(turnPage, Math.max(250, (item.seconds || 10) * 1000 / pageCount));
      };
      turnPage();
    } else {
      paint(rows);
      if (item.kind === 'poster' && c.layout === 'list-spotlight' && rows.length) {
        const lines = [...table.children]; let index = 0;
        const highlight = () => {
          if (!card.isConnected) return;
          lines.forEach((line, position) => line.classList.toggle('is-highlighted', position === index));
          index = (index + 1) % lines.length;
          setTimeout(highlight, Math.max(1, Number(c.secondsPerItem) || 10) * 1000);
        };
        highlight();
      }
    }
    if (item.kind === 'poster' && ['spotlight','campaign'].includes(c.layout) && rows.length) { let index = 0; const rotate = () => { if (!card.isConnected) return; paint([rows[index++ % rows.length]]); setTimeout(rotate, Math.max(1, Number(c.secondsPerItem) || 10) * 1000); }; rotate(); }
  }
  if (item.kind === 'weather') {
    const reading = element('strong', 'Consultando o tempo…', card, 'weather-temperature'); const detail = element('p', '', card);
    const params = new URLSearchParams({latitude:c.latitude, longitude:c.longitude, current:'temperature_2m,relative_humidity_2m,wind_speed_10m', timezone:'auto'});
    fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {credentials:'omit', signal:AbortSignal.timeout(10000)}).then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(data => { if (!card.isConnected) return; const current = data.current; if (!current || !Number.isFinite(current.temperature_2m)) throw new Error(); reading.textContent = `${Math.round(current.temperature_2m)}°C`; detail.textContent = `Umidade ${current.relative_humidity_2m}% · Vento ${current.wind_speed_10m} km/h`; element('small', 'Dados: Open-Meteo', card); onReady(); }).catch(() => { if (card.isConnected) { reading.textContent = 'Tempo indisponível'; detail.textContent = 'Confira a conexão e as coordenadas da cidade.'; onError('A consulta de previsão do tempo falhou.'); } });
    return 'pending';
  }
}
