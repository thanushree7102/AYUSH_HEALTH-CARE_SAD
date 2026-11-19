// Document reader for the WhatsApp bot (ported from AYUSH platform v3.5).
// Engine 1 (best, reads handwriting + Hindi): vision AI when ANTHROPIC_API_KEY is set.
// Engine 2 (fallback): Tesseract photo reader + keyword rules (printed English only).
// The result is only a DRAFT: the patient checks it before anything is saved.
const fs = require('fs');
const path = require('path');
const SYS = ['ayurveda', 'yoga', 'unani', 'siddha', 'homoeopathy'];
const KW={ayurveda:/taila|tailam|avipattikar|triphala|ashwagandha|guggulu|trikatu|kashayam|kashaya|churna|vati\b|ghrita|bhasma|prakriti|vikriti|vata|pitta|kapha|panchakarma|arishta|asava|ayurved|vaidya|baidyanath|zandu|dabur|patanjali|आयुर्वेद|चूर्ण/g,siddha:/chooranam|mathirai|kudineer|thailam|parpam|chenduram|vatham|pitham|kabam|varmam|siddha/g,unani:/majun|qurs|sharbat|arq\b|mizaj|hijama|safravi|balghami|saudavi|damvi|unani/g,homoeopathy:/\b\d+\s?(?:c|ch|cm|x)\b|\bq\b|dilution|pulsatilla|nux vomica|arnica|sulphur|belladonna|calcarea|miasm|homoeo|homeo/g,yoga:/asana|pranayama|kriya|meditation|yoga|naturopathy|hydrotherapy|mud therapy/g};
const FIELDS={ayurveda:['Prakriti','Vikriti'],yoga:['Stress','Sleep'],unani:['Mizaj'],siddha:['Mukkutram'],homoeopathy:['Miasm']};
const MED=/(\btab(?:let)?s?\b|\bcap(?:sule)?s?\b|\bsyp\b|syrup|powder|tailam|taila\b|\btsp\b|kashayam|kashaya|churna|chooranam|vati\b|mathirai|ghrita|thailam|parpam|chenduram|majun|qurs|sharbat|arq\b|bhasma|\b\d+\s?(?:c|ch|cm|x)\b|\d+\s?(?:mg|ml|gm)\b)/i;
const DOSE=/\d+(?:\.\d+)?\s?(?:mg|ml|gm|g|c|ch|cm|x|tsp|tbsp|tabs?|tablets?|caps?|capsules?|drops?)\b/i,FREQ=/\b(\d-\d-\d(?:-\d)?|od|bd|bid|tds|tid|qid|hs|twice daily|once daily|thrice daily|three times (?:a day|daily)|two times (?:a day|daily)|twice a day|once a day|at night|at bedtime|before food|after food)\b/i,DUR=/\d+\s*(?:days?|weeks?|wks?|months?|d)\b/i; // 7d, 7 days, 2 weeks
const iso=s=>{const m=(s||'').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);return m?`${m[3].length==2?'20'+m[3]:m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
// system-specific medicine details: Ayurveda Matra(dose)/Anupana/Kala, Siddha Anupana, Unani Badal, Homoeopathy Potency/Repetition
const MEDF={ayurveda:['Form','Anupana','Kala'],siddha:['Form','Anupana'],unani:['Form','Badal'],homoeopathy:['Potency','Repetition'],yoga:[]};
const FORM=/(powder|kashayam|kashaya|kwath|churna|chooranam|vati|vatika|gutika|mathirai|ghrita|ghritam|thailam|taila|parpam|chenduram|bhasma|arishta|asava|lehyam|leha|majun|qurs|sharbat|arq|jawarish|itrifal|tincture|dilution|globules)/i;
const medExtra=l=>({Form:(l.match(FORM)||[''])[0],Anupana:(l.match(/(?:anupa?nam?a?|along with|with)\s*[:\-]?\s*(warm water|hot water|rose water|honey|milk|ghee|buttermilk|jaggery|water)/i)||[])[1]||'',
  Kala:(l.match(/(before food|after food|empty stomach|at bedtime|after meals|before meals)/i)||[''])[0],Potency:(l.match(/\b(\d+\s?(?:c|ch|cm)|1m|10m|50m|lm\s?\d+|\d+x)\b/i)||[''])[0],
  Badal:(l.match(/(?:badal|substitute)\s*[:\-]?\s*([a-z ]{3,25})/i)||[])[1]||'',Repetition:(l.match(/(?:repeat|rep\.?)\s*[:\-]?\s*([^,\n]{2,30})/i)||[])[1]||''});
// lab report lines like "Haemoglobin 11.2 g/dL (12-16)" -> {test, value, range}  (the basic reader's way of reading lab reports)
const labLines=t=>t.split(/\n/).map(l=>l.match(/^\s*([A-Za-z][A-Za-z0-9 .\-\/]{2,40}?)\s*[:\-]?\s+(\d+(?:\.\d+)?)\s*([A-Za-z%µ\/0-9^.]*)\s*\(?\s*(\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?)\s*\)?\s*$/)).filter(Boolean).map(m=>({test:m[1].trim(),value:m[2]+(m[3]?' '+m[3]:''),range:m[4].replace(/\s+/g,'')})).slice(0,12);
function cleanOcrBlock(value) {
  return String(value || '').replace(/\r/g, '\n').replace(/[|]+/g, ' ')
    .split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean).join('\n').replace(/\n{2,}/g, '\n').trim();
}
function section(text, label, stops) {
  const stop = stops.join('|');
  const re = new RegExp('(?:^|\\n)\\s*' + label + '\\s*[:\\-]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:' + stop + ')\\b|$)', 'i');
  const m = text.match(re);
  return m ? m[1].replace(/^[\\s:;\\-]+|[\\s:;\\-]+$/g, '').replace(/\s+/g, ' ').trim() : '';
}
function extract(text) {
  let t = cleanOcrBlock(text);
  // Small, context-bound corrections for frequent OCR confusions in the supplied sample format.
  // Do not run a general medical spell-corrector: uncertain clinical text must remain reviewable.
  t = t.replace(/\bAtzes\b/gi, 'Atees').replace(/\bAines(?=\s+powder)\b/gi, 'Atees')
    .replace(/\bcald\b/gi, 'cold').replace(/\bwth\b/gi, 'with')
    .replace(/\bagestive\b/gi, 'digestive').replace(/\bfeoblems\b/gi, 'problems')
    .replace(/\brespitatary\b/gi, 'respiratory').replace(/\binfecnans\b/gi, 'infections');
  const lc = t.toLowerCase();
  const pick = (r) => (t.match(r) || [])[1]?.trim() || '';
  const score = Object.fromEntries(SYS.map(s => [s, (lc.match(KW[s]) || []).length]));
  // Explicit document titles are stronger than keyword counts.
  if (/ayurvedic\s+prescription/i.test(t)) score.ayurveda += 10;
  if (/yoga\s+(?:and|&)\s*naturopathy/i.test(t)) score.yoga += 10;
  if (/unani\s+prescription/i.test(t)) score.unani += 10;
  if (/siddha\s+prescription/i.test(t)) score.siddha += 10;
  if (/homoeopathic?\s+prescription/i.test(t)) score.homoeopathy += 10;
  const best = SYS.reduce((a, b) => score[b] > score[a] ? b : a, 'ayurveda');
  const system = score[best] ? best : '';
  const findings = {};
  for (const f of FIELDS[system || 'ayurveda']) {
    // Only accept an explicitly labelled field; never infer Prakriti from a stray OCR token.
    findings[f] = pick(new RegExp('(?:^|\\n)\\s*' + f + '\\s*[:\\-]\\s*([^\\n,;.]+)', 'i'));
  }
  const complaint = section(t, '(?:reported\\s+sym\\w*|chief\\s+complaint|complaints?|symptoms|c\\/o)', [
    'PRESCRIPTION','MEDICINES','MEDICATION','TREATMENT','EMOTION','ADVICE','INVESTIGATIONS','TESTS','SIGNATURE'
  ]);
  const diagnosis = pick(/(?:^|\n)\s*(?:diagnosis|clinical diagnosis|dx)\s*[:\-]\s*([^\n;]+)/i)
    .replace(/^reported symptoms?$/i, '');
  const remedy = section(t, '(?:remedy|treatment|prescription details)', [
    'EMOTION','EMOTIONAL','HEALTH TIP','NOTE','SIGNATURE','DOCTOR'
  ]);
  const meds = [];
  if (remedy) {
    // A labelled remedy is a medicine candidate. Keep dose blank unless it is explicitly stated.
    const first = remedy.split(/\b(?:can be|to be taken|take with|should be taken)\b/i)[0]
      .replace(/^[\s:;.-]+|[\s:;.-]+$/g, '').replace(/^remedy\s*[:\-]?\s*/i, '').trim();
    if (first && first.length <= 100) meds.push({ name: first, dose: '', freq: '', duration: '', extra: {} });
  }
  if (!meds.length) {
    const lab = labLines(t);
    if (lab.length < 2) {
      t.split(/\n|;|\.\s+(?=[A-Z])/).filter(l => l.length < 160 && MED.test(l)).forEach(l => {
        l = l.replace(/[|]+/g, ' ').replace(/\s{2,}/g, ' ');
        const dose = (l.match(DOSE) || [''])[0], freq = (l.match(FREQ) || [''])[0], duration = (l.match(DUR) || [''])[0];
        const name = l.replace(dose, '').replace(freq, '').replace(duration, '').trim()
          .replace(/^[\s\d.\-)*]+/, '').replace(/^(?:rx|r\/|℞)[\s:.\-]*/i, '')
          .replace(/[\s,\-:.]+$/, '');
        if (name) meds.push({ name, dose, freq, duration, extra: Object.fromEntries(Object.entries(medExtra(l)).filter(([, v]) => v)) });
      });
    }
  }
  const advice = remedy.match(/\b(?:can be taken|to be taken|should be taken)\b[\s\S]*/i)?.[0]
    || pick(/(?:advice|pathya|pathyam|ghiza|diet)\s*[:\-]?\s*([^\n.;|]+)/i);
  const labs = labLines(t);
  return {
    system, results: labs, doc_type: labs.length >= 2 ? 'lab_report' : (/prescription/i.test(t) ? 'prescription' : ''),
    doctor: pick(/(dr\.?\s+[a-z]+(?:\s[a-z]{2,})?)/i), date: iso(t),
    complaint, diagnosis, advice,
    allergies: pick(/allerg(?:y|ic)\s*(?:to|:)?\s*([a-z, ]+)/i),
    findings, medicines: meds
  };
}
const PROMPT=`You read Indian AYUSH prescriptions (Ayurveda, Yoga & Naturopathy, Unani, Siddha, Homoeopathy), including handwriting and Hindi/Devanagari. Return ONLY one JSON object, no other text: {"transcription":"all text you can read","doc_type":"prescription, lab_report, discharge_summary or other","summary":"2-3 plain sentences a patient can understand: what this document is, the main diagnosis or findings, the medicines and the advice; say 'not clearly readable' for anything unclear","results":[{"test":"","value":"","range":""}],"system":"ayurveda|yoga|unani|siddha|homoeopathy, or empty string if this is modern/allopathic medicine","doctor":"","date":"YYYY-MM-DD or empty","complaint":"","diagnosis":"","advice":"","allergies":"","findings":{"Prakriti":"","Vikriti":"","Mizaj":"","Mukkutram":"","Miasm":"","Stress":"","Sleep":""},"medicines":[{"name":"","dose":"","freq":"","duration":"","extra":{"Form":"","Anupana":"","Kala":"","Potency":"","Badal":"","Repetition":""}}]}. Translate Hindi to English. For lab reports fill "results" with up to 12 key test values (empty list otherwise). Use an empty string for anything not written. Never guess or invent.`;
async function visionRead(file,mime,text){const content=text?[{type:'text',text:PROMPT+'\n\nThe patient typed this description instead of sending a photo:\n'+text}]:[{type:mime==='application/pdf'?'document':'image',source:{type:'base64',media_type:mime,data:fs.readFileSync(file).toString('base64')}},{type:'text',text:PROMPT}]; // photos and PDF reports
  const r=await fetch((process.env.ANTHROPIC_BASE_URL||'https://api.anthropic.com')+'/v1/messages',{method:'POST',headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:process.env.ANTHROPIC_MODEL||'claude-sonnet-5-5',max_tokens:3000,messages:[{role:'user',content}]})});
  if(!r.ok)throw new Error('vision API '+r.status);const t=(await r.json()).content.map(c=>c.text||'').join('');return JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1))}
const normalize=v=>{const sys=SYS.includes(v.system)?v.system:'';return {system:sys,summary:String(v.summary||'').slice(0,800),doc_type:v.doc_type||'',results:(v.results||[]).filter(r=>r&&r.test).slice(0,12).map(r=>({test:String(r.test),value:String(r.value||''),range:String(r.range||'')})),doctor:v.doctor||'',date:v.date||'',complaint:v.complaint||'',diagnosis:v.diagnosis||'',advice:v.advice||'',allergies:v.allergies||'',
  findings:Object.fromEntries(Object.entries(v.findings||{}).filter(([k,x])=>x&&(FIELDS[sys]||[]).includes(k))),
  medicines:(v.medicines||[]).filter(m=>m.name).map(m=>({name:m.name,dose:m.dose||'',freq:m.freq||'',duration:m.duration||'',extra:Object.fromEntries(Object.entries(m.extra||{}).filter(([,x])=>x))}))}};
// Photo reader fallback (Tesseract). The English language file ships in ./tessdata so it works OFFLINE; without it, it would be downloaded from the internet.
const TESS=path.join(__dirname,'..','tessdata'),OCR_MS=+process.env.OCR_TIMEOUT_MS||70000;
// One worker is kept warm between photos (starting a worker is the slow part) and shut down after 2 idle minutes.
let ocrW = null, ocrIdle = null, ocrChain = Promise.resolve();
const getWorker = () => {
  if (!ocrW) {
    const {createWorker}=require('tesseract.js'),local=fs.existsSync(path.join(TESS,'eng.traineddata'));
    ocrW = createWorker('eng',1,{...(local?{langPath:TESS,gzip:false,cacheMethod:'none'}:{}),errorHandler:e=>console.error('photo reader:',e?.message||e)});
    ocrW.catch(()=>{ocrW=null});
  }
  return ocrW;
};
const dropWorker = () => { const w=ocrW; ocrW=null; if(w) w.then(x=>x.terminate()).catch(()=>{}); };
async function ocrFile(file){
  const job = ocrChain.then(async()=>{ // photos are read one at a time
    clearTimeout(ocrIdle);
    try {
      const w = await getWorker();
      await w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
      return (await w.recognize(file)).data.text;
    }
    finally{ ocrIdle=setTimeout(dropWorker,120000); ocrIdle.unref&&ocrIdle.unref() }
  });
  ocrChain = job.catch(()=>{});
  let timer;
  try {
    return await Promise.race([job, new Promise((_, rej) => {
      timer = setTimeout(() => {
        dropWorker();
        rej(new Error('the photo reader took too long (check the local English OCR data file and server resources)'));
      }, OCR_MS);
      timer.unref && timer.unref();
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function readInput({file,mime,text}){let raw=text||'',ex=null,why='';
  if(process.env.ANTHROPIC_API_KEY){try{const v=await visionRead(file,mime,text);raw=v.transcription||raw;ex=normalize(v);ex._engine='AI vision'}catch(err){why=err.message;console.error('AI read failed, using fallback:',err.message)}}
  if(!ex){const pdf=mime==='application/pdf';
    if(file&&!pdf){try{raw=await ocrFile(file)}catch(err){why='Photo reader failed: '+err.message;console.error('OCR failed:',err.message)}}
    else if(pdf)why=why||'PDF reports need the AI reader (set ANTHROPIC_API_KEY). Send a photo of the page, or type the details.';
    ex=extract(raw);ex._engine=file?(pdf?'no reader for PDF':'Tesseract (printed English only)'):'basic rules';ex._note=why||(process.env.ANTHROPIC_API_KEY?'':'ANTHROPIC_API_KEY is not set')}
  if(!ex.summary){ex.summary=makeSummary(ex);ex._sumAuto=true} // plain-language summary: written by the AI, or built from the fields found
  return {raw,ex}}

const SYSL={ayurveda:'Ayurveda',yoga:'Yoga & Naturopathy',unani:'Unani',siddha:'Siddha',homoeopathy:'Homoeopathy'};
function makeSummary(x){const L=[],j=a=>a.filter(Boolean).join(', '),kind=['lab_report','discharge_summary'].includes(x.doc_type)?x.doc_type.replace('_',' '):'record';
  const meds=(x.medicines||[]).filter(m=>m.name).map(m=>m.name+(j([m.dose,m.freq,m.duration])?' ('+j([m.dose,m.freq,m.duration])+')':'')),fd=Object.entries(x.findings||{}).filter(([,v])=>v).map(([k,v])=>k+': '+v).join(', ');
  const rs=(x.results||[]).filter(r=>r&&r.test).map(r=>{const v=parseFloat(r.value),g=(r.range||'').match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/),flag=g&&!isNaN(v)?(v<+g[1]?'low':v>+g[2]?'high':''):'',p=[flag,r.range&&'normal '+r.range].filter(Boolean); // low/high flag from the normal range printed on the report
    return `${r.test} ${r.value}${p.length?' ('+p.join('; ')+')':''}`});
  if(!(x.system||x.complaint||x.diagnosis||meds.length||fd||x.advice||rs.length))return '';
  L.push(`${x.system?SYSL[x.system]:'Medical'} ${kind}${x.doctor?' from '+x.doctor:''}${x.date?' dated '+x.date:''}.`);
  if(x.complaint)L.push('Problem: '+x.complaint+'.');if(x.diagnosis)L.push('Diagnosis: '+x.diagnosis+'.');if(fd)L.push(fd+'.');if(rs.length)L.push(`${rs.length} result${rs.length>1?'s':''}: ${rs.join('; ')}.`);
  if(meds.length)L.push('Medicines: '+meds.join('; ')+'.');if(x.advice)L.push('Advice: '+x.advice+'.');return L.join(' ')}

module.exports = { SYS, SYSL, FIELDS, MEDF, extract, readInput, makeSummary };
