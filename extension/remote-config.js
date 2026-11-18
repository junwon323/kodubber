function normalizeOfficeOrigin(value) {
 const text=String(value||'').trim();
 if(!text)throw Error('클라우드 서버 주소를 입력해 주세요.');
 let url;try{url=new URL(text.includes('://')?text:'https://'+text);}catch{throw Error('올바른 서버 IP 또는 도메인을 입력해 주세요.');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('HTTPS 서버 주소만 입력해 주세요. 경로나 계정 정보는 제외하세요.');
 return url.origin;
}
