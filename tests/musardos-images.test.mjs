import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedPhotoUrl,normalizePhoto,parsePhotoExport,parseProductSearchList,MusardosImages,MUSARDOS_API} from '../src/musardos-images.mjs';

test('ListaPreco extrai apenas nomes, aceita CSV com cabeçalho e rejeita a lista inteira quando inválida',()=>{
  const result=parseProductSearchList('1001;QUEIJO SÁDIA;30;5,90;\n1002;queijo sadia;10;9,90;\n1003;Pão integral;8;0,00;');
  assert.equal(result.records,3);assert.equal(result.names.length,2);assert.equal(result.duplicates,1);
  assert.deepEqual(result.names,['queijo sadia','Pão integral']);
  assert.deepEqual(parseProductSearchList('nome;preco\n"Queijo; artesanal";12,50').names,['Queijo; artesanal']);
  assert.throws(()=>parseProductSearchList('1001;Produto;10;1,00;\n1002;;20;2,00;'),/Nome/);
  assert.throws(()=>parseProductSearchList('texto sem formato'),/ListaPreco/);
});

const imageUrl=name=>'https://bucket.musardos.com/produto/'+name+'.png';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('Musardos envia o contrato de login e cabeçalhos de escopo sem presumir permissão administrativa',async()=>{
  const calls=[];
  const provider=new MusardosImages({fetcher:async(url,options)=>{calls.push({url,options});return url.endsWith('/Usuarios/Login')?json({Id:12,Login:'operador',Token:'test-session-token',ClienteId:'7,7,9',ClienteKey:'key-seven,key-nine',GrupoUsuarioId:2}):json({items:[{url:imageUrl('queijo') ,filename:'queijo.png'}],hasMore:false});}});
  const user=await provider.login(' operador ',' senha de teste ');
  assert.equal(calls[0].url,MUSARDOS_API+'/Usuarios/Login');
  assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body),{Login:'operador',Senha:'senha de teste'});
  assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal(user.staff,false);
  const scopes=provider.scopes(user);assert.deepEqual(scopes.map(scope=>scope.id),['shared','client:7','client:9']);
  await provider.page(user,{...scopes[1],cursor:'page/2+next'});
  const call=calls[1],url=new URL(call.url);
  assert.equal(url.pathname,'/ms/api/ProdutoImagens/ClienteLibrary');assert.equal(url.searchParams.get('clienteId'),'7');assert.equal(url.searchParams.get('pageSize'),'48');assert.equal(url.searchParams.get('continuationToken'),'page/2+next');
  assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.Authorization,'Bearer test-session-token');assert.equal(call.options.headers.ClienteId,'7,7,9');assert.equal(call.options.headers.ClienteKey,'key-seven,key-nine');
  await provider.page({...user,staff:true},scopes[0]);
  assert.equal(calls[2].options.headers.ClienteId,'0');assert.equal(calls[2].options.headers.ClienteKey,undefined);
  assert.equal(new URL(calls[2].url).pathname,'/ms/api/ProdutoImagens/SharedLibrary');
});

test('paginação exige confirmação de hasMore e cursor progressivo; falhas de acesso mantêm códigos distintos',async()=>{
  const user={id:'1',token:'test-token',clientId:'7',clientKey:'',staff:false},scope={id:'shared',cursor:'same-page'};
  for(const body of [{items:[]},{items:[],hasMore:'false'},{items:[],hasMore:true,continuationToken:'next'},{items:[imageUrl('a')],hasMore:true},{items:[imageUrl('a')],hasMore:true,continuationToken:'same-page'}]){
    const provider=new MusardosImages({fetcher:async()=>json(body)});
    await assert.rejects(provider.page(user,scope),error=>error.status===502);
  }
  for(const status of [401,403,429]){
    const provider=new MusardosImages({fetcher:async()=>json({},status)});
    await assert.rejects(provider.page(user,scope),error=>error.status===status);
  }
  const provider=new MusardosImages({fetcher:async()=>json({items:[imageUrl('a')],hasMore:false,continuationToken:'unused'})});
  const final=await provider.page(user,scope);assert.equal(final.hasMore,false);assert.equal(final.cursor,null);assert.equal(final.items.length,1);
  const malformed=new MusardosImages({fetcher:async()=>new Response('<html>login</html>')});
  await assert.rejects(malformed.page(user,scope),error=>error.status===502);
  const invalidLogin=new MusardosImages({fetcher:async()=>json({Id:1,Token:'token\r\nInjected: yes',ClienteId:'7'})});
  await assert.rejects(invalidLogin.login('operador','test-password'),error=>error.status===502);
});

test('exportações JSON e CSV preservam URLs, nomes e marcas e rejeitam registros fora da origem permitida',()=>{
  const url=imageUrl('queijo-branco-sadia');
  const csv='\uFEFFURL da imagem;Nome;Marca\r\n'+url+';"Queijo; branco";Sádia';
  const rows=parsePhotoExport(csv);assert.equal(rows[0].name,'Queijo; branco');assert.equal(rows[0].brand,'Sádia');assert.equal(rows[0].url,url);
  assert.deepEqual(parsePhotoExport(JSON.stringify({items:[{sourceUrl:url,nome:'Queijo; branco',marca:'Sádia'}],complete:true})),rows);
  assert.equal(parsePhotoExport(JSON.stringify([url]))[0].filename,'queijo-branco-sadia.png');
  assert.equal(normalizePhoto({Url:url,Filename:'presunto.png',Nome:'Presunto'}).name,'Presunto');
  assert.throws(()=>parsePhotoExport('nome;preco\nQueijo;10'),/coluna/);
  assert.throws(()=>parsePhotoExport('url;nome\n'+url+';"Queijo'),/aspas/);
  assert.throws(()=>parsePhotoExport(JSON.stringify([url,'https://example.com/imagem.png'])),error=>error.status===400);
  assert.throws(()=>parsePhotoExport('{broken'),/JSON/);
});

test('URLs de fotos ficam restritas a HTTPS no caminho público de produtos, sem credenciais ou redirecionadores',()=>{
  assert.equal(allowedPhotoUrl(imageUrl('linguica-aurora')),imageUrl('linguica-aurora'));
  assert.equal(allowedPhotoUrl('https://bucket.musardos.com/produto/queijo.avif'),'https://bucket.musardos.com/produto/queijo.avif');
  for(const url of [
    'http://bucket.musardos.com/produto/a.png',
    'https://bucket.musardos.com.evil.example/produto/a.png',
    'https://user:password@bucket.musardos.com/produto/a.png',
    'https://bucket.musardos.com:8443/produto/a.png',
    'https://bucket.musardos.com/fonts/a.png',
    'https://bucket.musardos.com/produto/a.svg',
    imageUrl('a')+'?redirect=https://example.com/',
    imageUrl('a')+'#fragment',
    'https://bucket.musardos.com/produto/..%2ffonts/a.png',
  ])assert.throws(()=>allowedPhotoUrl(url),error=>error.status===400,url);
});
