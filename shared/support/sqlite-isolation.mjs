// SQLite performs native I/O without node:fs. Protect its constructors and file SQL too.
const denied=()=>{throw Object.assign(new Error('SUPPORT_WRITE_DENIED'),{code:'SUPPORT_WRITE_DENIED'});};
const tokens=sql=>[...String(sql).matchAll(/\s+|--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|\?(?:\d+)?|[:@$][\w]+|[a-zA-Z_][\w$]*|[^\s]/g)].map(value=>value[0]).filter(value=>!/^\s|^--|^\/\*/.test(value));
function fileOperations(sql) {
  const words=tokens(sql),operations=[];
  for(let i=0;i<words.length;i++) {
    const word=words[i].toUpperCase();
    if(/^(?:LOAD_EXTENSION|TEMP_STORE_DIRECTORY|DATA_STORE_DIRECTORY)$/.test(word))denied();
    if(word!=='ATTACH'&&word!=='VACUUM')continue;
    let target=i+1;
    if(word==='ATTACH'&&words[target]?.toUpperCase()==='DATABASE')target++;
    if(word==='VACUUM') {
      if(words[target]?.toUpperCase()!=='INTO')target++;
      if(words[target]?.toUpperCase()!=='INTO')continue;
      target++;
    }
    const token=words[target],after=words[target+1]?.toUpperCase();
    // Expressions/functions can synthesize arbitrary filenames. Only a single
    // literal or bind parameter is accepted for a native file operation.
    if(!token||(word==='ATTACH'?after!=='AS':after!==undefined&&after!==';'))denied();
    if(/^(?:'|"|`|\[)/.test(token)) {
      const quote=token[0],value=token.slice(1,-1).replaceAll(quote+quote,quote);operations.push({literal:value});
    } else if(/^\?(?:\d+)?$/.test(token)) {
      // File operations have no preceding value parameters in supported SQL.
      if(words.slice(0,target).some(value=>/^(?:\?|[:@$])/.test(value)))denied();
      operations.push({position:token==='?'?0:Number(token.slice(1))-1});
    } else if(/^[:@$]\w+$/.test(token))operations.push({name:token.slice(1)});
    else denied();
  }
  return operations;
}
export function installSqliteIsolation(require,check) {
  const resolved=require.resolve('better-sqlite3'),Constructor=require(resolved),cache=require.cache[resolved],restore=[];
  const file=value=>{if(value!==':memory:'){if(typeof value!=='string'||!value)denied();check(value);}};
  const validate=(operations,args)=>{for(const operation of operations){let value=operation.literal;if('position'in operation)value=args[operation.position];if(operation.name){const object=args.find(value=>value&&typeof value==='object'&&!ArrayBuffer.isView(value));value=object?.[operation.name];}file(value);}};
  const patch=(object,key,wrap)=>{const original=object[key];object[key]=wrap(original);restore.push(()=>{object[key]=original;});};
  patch(Constructor.prototype,'exec',original=>function(sql,...args){file(this.name);validate(fileOperations(sql),[]);return original.call(this,sql,...args);});
  patch(Constructor.prototype,'prepare',original=>function(sql,...options){
    file(this.name);const operations=fileOperations(sql);
    for(const operation of operations)if(operation.literal!==undefined)file(operation.literal);
    const statement=original.call(this,sql,...options);if(!operations.length)return statement;
    let bound;
    for(const method of ['run','get','all','iterate']) {
      const execute=statement[method];statement[method]=function(...args){validate(operations,bound??args);return execute.apply(this,args);};
    }
    const bind=statement.bind;statement.bind=function(...args){validate(operations,args);const result=bind.apply(this,args);bound=args;return result;};return statement;
  });
  patch(Constructor.prototype,'backup',original=>async function(target,...args){file(this.name);file(target);return original.call(this,target,...args);});
  patch(Constructor.prototype,'pragma',original=>function(sql,...args){file(this.name);fileOperations(`PRAGMA ${sql}`);return original.call(this,sql,...args);});
  patch(Constructor.prototype,'loadExtension',()=>()=>denied());
  const Guarded=new Proxy(Constructor,{construct(target,args,newTarget){file(args[0]);return Reflect.construct(target,args,newTarget===Guarded?target:newTarget);},apply(target,thisArg,args){file(args[0]);return Reflect.apply(target,thisArg,args);}});
  patch(Constructor.prototype,'constructor',()=>Guarded);cache.exports=Guarded;
  return ()=>{cache.exports=Constructor;for(const undo of restore.reverse())undo();};
}
