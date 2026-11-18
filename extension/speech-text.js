function speechText(text, seen = new Set()) {
 text = text.replace(/(^|[^\w])\*\*\s*([^*]+?)\s*\*\*(?=$|[^\w])/g, (_, before, inner) => before + inner.trim())
   .replace(/(^|[^\w])__\s*([^_]+?)\s*__(?=$|[^\w])/g, (_, before, inner) => before + inner.trim());
 const notation = {
  '1':['상수 시간','일'], 'n':['선형 시간','엔'], 'm':['선형 시간','엠'],
  'logn':['로그 시간','로그 엔'], 'nlogn':['엔 로그 엔 시간','엔 로그 엔'], 'logm':['로그 시간','로그 엠'], 'mlogm':['엠 로그 엠 시간','엠 로그 엠'],
  'n^2':['제곱 시간','엔 제곱'], 'n²':['제곱 시간','엔 제곱'],
  'n^3':['세제곱 시간','엔 세제곱'], 'n³':['세제곱 시간','엔 세제곱'],
  '2^n':['지수 시간','이의 엔 제곱'], 'n!':['팩토리얼 시간','엔 팩토리얼']
 };
 text = text.replace(/(?:(시간\s*복잡도|공간\s*복잡도)(는|가|:)?\s*)?\bO\s*\(\s*([^()]+)\s*\)(\s*시간(?:에|으로|이|은|을|의|도)?)?/gi,(original,kind,particle,expr,timeSuffix)=>{
  const key=expr.toLowerCase().replace(/\s+/g,'');if(!notation[key])return original;
  const scope=kind?.startsWith('공간')?'space':'time',id=scope+key;
  const [meaning,sound]=notation[key];const first=!seen.has(id);seen.add(id);
  const definition=scope==='space'?meaning.replace('시간','공간'):meaning;
  return (kind?kind.replace(/\s/g,'')+(particle||'')+' ':'')+(first?definition+'인 ':'')+'빅오 '+sound+(timeSuffix ? (timeSuffix.trim()==='시간에' || timeSuffix.trim()==='시간으로' ? '로' : timeSuffix.trim().slice(2)) : '');
 });
 return mathSpeech(text).replace(/`([^`]+)`/g, '$1');
}

// Conservative spoken rendering of common standalone mathematical notation.
// Identifiers, URLs and code operators with language-dependent meaning are left alone.
function mathSpeech(text) {
 const letters={a:'에이',b:'비',c:'씨',d:'디',e:'이',f:'에프',g:'지',h:'에이치',i:'아이',j:'제이',k:'케이',l:'엘',m:'엠',n:'엔',o:'오',p:'피',q:'큐',r:'알',s:'에스',t:'티',u:'유',v:'브이',w:'더블유',x:'엑스',y:'와이',z:'지'};
 function number(value) {
  if(value.startsWith('-'))return '마이너스 '+number(value.slice(1));
  if(value.startsWith('+'))return '플러스 '+number(value.slice(1));
  const [whole,fraction]=value.split('.'),digits=['영','일','이','삼','사','오','육','칠','팔','구'];
  if(whole.length>12)return value; // Do not round large integers through Number.
  let result='';const units=['','만','억'];
  for(let end=whole.length,group=0;end>0;end-=4,group++){
   const part=whole.slice(Math.max(0,end-4),end);let spoken='';
   for(let i=0;i<part.length;i++){const d=Number(part[i]),power=part.length-i-1;if(d)spoken+=(d===1&&power?'':digits[d])+['','십','백','천'][power];}
   if(spoken)result=spoken+units[group]+(result?' '+result:'');
  }
  return (result||'영')+(fraction?' 점 '+[...fraction].map(d=>digits[Number(d)]).join(' '):'');
 }
 const atom='(?:\\d+(?:\\.\\d+)?|[A-Za-z])';
 const sound=value=>/^[+-]/.test(value)?(value[0]==='-'?'마이너스 ':'플러스 ')+sound(value.slice(1)):/^[A-Za-z]$/.test(value)?letters[value.toLowerCase()]:number(value);
 const power=(base,exponent)=>sound(base)+'의 '+(exponent==='2'?'제곱':exponent==='3'?'세제곱':sound(exponent)+' 제곱');
 const protectedText=[];
 // Keep URLs, paths, and quoted code intact. The translator verbalizes actual code semantics.
 text=text.replace(/https?:\/\/[^\s]+|`[^`]+`|\b[A-Za-z]:\\[^\s]+|(?<!\S)(?:\/|\.{1,2}\/)[A-Za-z_][^\s]*/g,value=>{protectedText.push(value);return '\uE000'+(protectedText.length-1)+'\uE001';});
 // A caret in explicit code/bitwise context must not be guessed to mean exponentiation.
 if(/\b(?:Python|JavaScript|TypeScript|XOR|bitwise)\b|비트|코드/.test(text)) {
  text=text.replace(/(?<![\w.])(?:\d+(?:\.\d+)?|[A-Za-z])\s*\^\s*(?:\d+(?:\.\d+)?|[A-Za-z])(?![\w.])/g,value=>{protectedText.push(value);return '\uE000'+(protectedText.length-1)+'\uE001';});
 }
 const boundary='(?<![\\w.])',tail='(?![\\w.])';
 const replace=(pattern,fn)=>{text=text.replace(new RegExp(boundary+pattern+tail,'g'),fn);};
 replace('(\\d+(?:\\.\\d+)?)[eE]([+-]?\\d+)',(_,base,exponent)=>number(base)+' 곱하기 '+power('10',exponent));
 // exp is the natural exponential function, never a synonym for ten to a power.
 replace('exp\\(\\s*('+atom+')\\s*\\)',(_,x)=>'자연상수 이의 '+sound(x)+' 제곱');
 replace('(?:sqrt\\(\\s*('+atom+')\\s*\\)|√\\s*('+atom+'))',(_,a,b)=>sound(a||b)+'의 제곱근');
 replace('log_([0-9]+)\\s*\\(\\s*('+atom+')\\s*\\)',(_,base,x)=>'밑이 '+number(base)+'인 로그 '+sound(x));
 replace('log([₂₃₁₀]+)\\s*('+atom+')',(_,base,x)=>'밑이 '+number([...base].map(c=>({'₂':'2','₃':'3','₁':'1','₀':'0'})[c]).join(''))+'인 로그 '+sound(x));
 replace('('+atom+')\\s*\\^\\s*(?:\\(\\s*([+-]?'+atom+')\\s*\\)|([+-]?'+atom+'))',(_,base,a,b)=>power(base,a||b));
 replace('('+atom+')\\s*\\*\\*\\s*([+-]?'+atom+')',(_,base,exp)=>power(base,exp));
 replace('('+atom+')([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)',(_,base,exp)=>power(base,[...exp].map(c=>({'⁻':'-','⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'})[c]).join('')));
 replace('('+atom+')\\s*의\\s*([+-]?'+atom+')\\s*제곱',(_,base,exp)=>power(base,exp));
 replace('('+atom+')\\s*의\\s*(마이너스|플러스)\\s*(\\d+)\\s*제곱',(_,base,sign,exp)=>power(base,(sign==='마이너스'?'-':'+')+exp));
 replace('([A-Za-z])\\s*의\\s*(제곱|세제곱|제곱근|팩토리얼)',(_,base,op)=>sound(base)+'의 '+op);
 replace('('+atom+')!',(_,base)=>sound(base)+' 팩토리얼');
 replace('([A-Za-z])\\s*/\\s*([A-Za-z])',(_,a,b)=>sound(a)+' 나누기 '+sound(b));
 const ops={'<=':'작거나 같음','≤':'작거나 같음','>=':'크거나 같음','≥':'크거나 같음','!=':'같지 않음','≠':'같지 않음','==':'같음','=':'같음','<':'작음','>':'큼'};
 // Preserve both operands and each operator in chained comparisons.
 const comparison=new RegExp(boundary+'('+atom+'(?:\\s*(?:<=|>=|!=|==|≤|≥|≠|=|<|>)\\s*'+atom+')+)'+tail,'g');
 text=text.replace(comparison,expr=>expr.replace(/<=|>=|!=|==|≤|≥|≠|=|<|>|\d+(?:\.\d+)?|[A-Za-z]/g,t=>ops[t]?' '+ops[t]+' ':sound(t)).replace(/\s+/g,' ').trim());
 replace('('+atom+')\\s*([×÷])\\s*('+atom+')',(_,a,op,b)=>sound(a)+(op==='×'?' 곱하기 ':' 나누기 ')+sound(b));
 text=text.replace(/\bexp(?=\s*함수)/g,'이엑스피').replace(/\bXOR\b/g,'엑스오어');
 // Slash, %, **, ^ in code can have different meanings: handled in the translation prompt.
 return text.replace(/\uE000(\d+)\uE001/g,(_,i)=>protectedText[Number(i)]);
}
