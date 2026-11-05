import {imageUrl} from './table-templates.js';

const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const formats = ['video/mp4;codecs=avc1.42001f','video/mp4;codecs=avc1'];

function loadImage(ref) {
  const url = imageUrl(ref);
  if (!url) return Promise.resolve(null);
  const image = new Image();
  image.src = url;
  return image.decode().then(()=>image);
}

function paint(ctx,width,height,slide,fade) {
  const {appearance:a,name,row,background,logo} = slide;
  ctx.fillStyle = a.background||'#153b39';
  ctx.fillRect(0,0,width,height);
  if (background) {
    const scale = Math.max(width/background.width,height/background.height);
    const w = background.width*scale,h = background.height*scale;
    ctx.drawImage(background,(width-w)/2,(height-h)/2,w,h);
  }
  if (a.gradient || background) {
    const gradient = ctx.createLinearGradient(0,0,0,height);
    gradient.addColorStop(0,'#0002');gradient.addColorStop(1,'#000a');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
  }
  const font = {sans:'sans-serif',serif:'serif',mono:'monospace'}[a.font]||'sans-serif';
  ctx.fillStyle = a.color||'#fff';
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.globalAlpha=fade;
  if (logo) {
    const scale = Math.min(width*.22/logo.width,height*.13/logo.height);
    ctx.drawImage(logo,(width-logo.width*scale)/2,height*.05,logo.width*scale,logo.height*scale);
  }
  const edge = Math.min(width,height);
  if (!a.hideHeader) {
    ctx.font = 'bold '+Math.round(edge*.056)+'px '+font;
    ctx.fillText(name,width/2,height*.28,width*.87);
  }
  ctx.font = 'bold '+Math.round(edge*.09)+'px '+font;
  ctx.fillText(row.name,width/2,height*.48,width*.89);
  ctx.font = 'bold '+Math.round(edge*.16)+'px '+font;
  ctx.fillText(money.format(row.price),width/2,height*.67,width*.86);
  if (a.showUnit!==false && row.unit) {
    ctx.font = Math.round(edge*.054)+'px '+font;
    ctx.fillText('por '+row.unit,width/2,height*.81,width*.85);
  }
  ctx.globalAlpha=1;
}

export async function recordCampaign(campaign,{vertical=false,seconds=2,onProgress=()=>{},signal}={}) {
  const mimeType = formats.find(format=>globalThis.MediaRecorder?.isTypeSupported(format));
  if (!mimeType || !HTMLCanvasElement.prototype.captureStream) throw new Error('Este navegador não oferece gravação MP4. Use uma versão recente de Chrome ou Edge com suporte a H.264.');
  if (!Number.isInteger(seconds)||seconds<1||seconds>6) throw new Error('Escolha de 1 a 6 segundos por produto.');
  const groups = await Promise.all(campaign.pieces.map(async ({appearance,rows}) => {
    const [background,logo] = await Promise.all([loadImage(appearance.backgroundImage),loadImage(appearance.logoImage)]);
    return rows.filter(row=>row.active).map(row=>({name:campaign.name,appearance,row,background,logo}));
  }));
  const slides = groups.flat();
  if (!slides.length) throw new Error('A campanha não tem produtos disponíveis para exportação.');
  signal?.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.width=vertical?720:1280;
  canvas.height=vertical?1280:720;
  const ctx = canvas.getContext('2d',{alpha:false});
  if (!ctx) throw new Error('O navegador não conseguiu preparar o quadro do vídeo.');
  const stream = canvas.captureStream(30);
  try {
    const recorder = new MediaRecorder(stream,{mimeType,videoBitsPerSecond:3_000_000});
    return await new Promise((resolve,reject) => {
      const chunks = [];
      let frame;
      const duration = slides.length*seconds*1000;
      const cancel = () => { if (recorder.state!=='inactive') recorder.stop(); };
      const finish = () => { cancelAnimationFrame(frame);signal?.removeEventListener('abort',cancel); };
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { finish();reject(new Error('O navegador não conseguiu codificar o MP4.')); };
      recorder.onstop = () => {
        finish();
        if (signal?.aborted) reject(signal.reason);
        else if (!chunks.length) reject(new Error('O navegador gerou um vídeo vazio.'));
        else resolve(new Blob(chunks,{type:'video/mp4'}));
      };
      paint(ctx,canvas.width,canvas.height,slides[0],1);
      recorder.start(1000);
      signal?.addEventListener('abort',cancel,{once:true});
      const start = performance.now();
      const render = now => {
        const elapsed = now-start;
        if (elapsed>=duration) { onProgress(1);cancel();return; }
        const index = Math.max(0,Math.floor(elapsed/(seconds*1000)));
        const fade = Math.max(.2,Math.min(1,(elapsed-index*seconds*1000)/240));
        paint(ctx,canvas.width,canvas.height,slides[index],fade);
        onProgress(Math.max(0,elapsed/duration));
        frame=requestAnimationFrame(render);
      };
      frame=requestAnimationFrame(render);
    });
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
