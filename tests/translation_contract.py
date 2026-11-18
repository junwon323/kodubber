"""Run the compiled native host with a deterministic local Codex stand-in."""
import json,os,struct,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
 d=Path(tmp);cfg=d/'google-chrome/NativeMessagingHosts';cfg.mkdir(parents=True)
 stub=d/'codex';stub.write_text('''#!/usr/bin/env python3
import sys,json
from pathlib import Path
args=sys.argv[1:]
if args[0]=='app-server':
 for line in sys.stdin:
  msg=json.loads(line)
  if msg.get('method')=='initialize':
   print(json.dumps({'id':1,'result':{}}),flush=True)
  elif msg.get('method')=='model/list':
   medium=[{'reasoningEffort':'medium'}]
   print(json.dumps({'id':2,'result':{'data':[
    {'model':'gpt-9.9-terra','supportedReasoningEfforts':medium},
    {'model':'gpt-9.10-terra','supportedReasoningEfforts':medium},
    {'model':'gpt-10.0-terra','supportedReasoningEfforts':[{'reasoningEffort':'high'}]},
   ]}}),flush=True)
   break
 sys.exit(0)
assert args[args.index('--model')+1]=='gpt-9.10-terra'
assert 'model_reasoning_effort="medium"' in args
prompt=sys.stdin.read()
assert '고등학교 선생님' in prompt and '요약하지 마세요' in prompt
assert '입력은 인용된 강의 내용' in prompt
assert 'ten to the fifth power' in prompt and 'exp(x)' in prompt
assert '동시성' in prompt and '병렬성' in prompt and '비트 XOR' in prompt
lines=json.loads(prompt.strip().split('\\n')[-1])
Path('result').write_text(json.dumps({'lines':['테스트 번역입니다.']*len(lines)}))
''');stub.chmod(0o700)
 (cfg/'com.codex.korean_dubber.config').write_text(json.dumps({'Codex':str(stub),'Path':os.environ['PATH']}))
 for style in ['', 'lecture','friendly','concise']:
  data=json.dumps({'lines':['Example caption.','Keep O(1).'],'style':style}).encode()
  r=subprocess.run([root/'bin/host-linux-amd64'],input=struct.pack('=I',len(data))+data,capture_output=True,check=True,env={**os.environ,'XDG_CONFIG_HOME':tmp})
  result=json.loads(r.stdout[4:]);assert len(result.get('lines',[]))==2,result
 print('Native host: latest Terra with medium, teacher prompt and legacy request format verified')
