function speechText(text, seen = new Set()) {
 text = text.replace(/(^|[^\w])\*\*\s*([^*]+?)\s*\*\*(?=$|[^\w])/g, (_, before, inner) => before + inner.trim())
   .replace(/(^|[^\w])__\s*([^_]+?)\s*__(?=$|[^\w])/g, (_, before, inner) => before + inner.trim())
   .replace(/`([^`]+)`/g, '$1');
 const notation = {
  '1':['상수 시간','일'], 'n':['선형 시간','엔'], 'm':['선형 시간','엠'],
  'logn':['로그 시간','로그 엔'], 'nlogn':['엔 로그 엔 시간','엔 로그 엔'], 'logm':['로그 시간','로그 엠'], 'mlogm':['엠 로그 엠 시간','엠 로그 엠'],
  'n^2':['제곱 시간','엔 제곱'], 'n²':['제곱 시간','엔 제곱'],
  'n^3':['세제곱 시간','엔 세제곱'], 'n³':['세제곱 시간','엔 세제곱'],
  '2^n':['지수 시간','이의 엔 제곱'], 'n!':['팩토리얼 시간','엔 팩토리얼']
 };
 return text.replace(/(?:(시간\s*복잡도|공간\s*복잡도)(는|가|:)?\s*)?\bO\s*\(\s*([^()]+)\s*\)(\s*시간(?:에|으로|이|은|을|의|도)?)?/gi,(original,kind,particle,expr,timeSuffix)=>{
  const key=expr.toLowerCase().replace(/\s+/g,'');if(!notation[key])return original;
  const scope=kind?.startsWith('공간')?'space':'time',id=scope+key;
  const [meaning,sound]=notation[key];const first=!seen.has(id);seen.add(id);
  const definition=scope==='space'?meaning.replace('시간','공간'):meaning;
  return (kind?kind.replace(/\s/g,'')+(particle||'')+' ':'')+(first?definition+'인 ':'')+'빅오 '+sound+(timeSuffix ? (timeSuffix.trim()==='시간에' || timeSuffix.trim()==='시간으로' ? '로' : timeSuffix.trim().slice(2)) : '');
 });
}
