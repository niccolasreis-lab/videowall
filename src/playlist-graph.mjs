import {createHash} from 'node:crypto';
import {HttpError} from './media.mjs';
export function createPlaylistGraph(db,contentDto,mustContent,clock){
 const list=()=>db.prepare('SELECT * FROM playlists').all();
 function expand(id,override){
  const byId=new Map(list().map(p=>[p.id,p]));if(override)byId.set(id,{id,revision:0,schedule_json:'{}',...byId.get(id),...override});
  const items=[],revisions={},stack=new Set();
  function visit(key,path=[]){const row=byId.get(key);if(!row)throw new HttpError(400,'Subplaylist não encontrada.');if(stack.has(key))throw new HttpError(400,'Referência circular entre playlists.');if(path.length&&JSON.parse(row.schedule_json||'{}').enabled)throw new HttpError(400,'Subplaylist com agenda própria: desative a agenda antes de inserir.');stack.add(key);revisions[key]=row.revision;
   for(const item of JSON.parse(row.items_json||'[]')){if(item.playlistId){visit(item.playlistId,[...path,item.id]);continue;}
    const leaf={...contentDto(mustContent(item.mediaId)),...item};if(path.length){const digest=createHash('sha256').update([...path,item.id].join('/')).digest('hex').slice(0,32);leaf.id=[digest.slice(0,8),digest.slice(8,12),digest.slice(12,16),digest.slice(16,20),digest.slice(20)].join('-');leaf.playlistPath=[...path];}items.push(leaf);if(items.length>500)throw new HttpError(400,'A sequência expandida aceita até 500 itens.');}
   stack.delete(key);
  }visit(id);return {items,revisions};
 }
 function syncDependencies(){db.prepare('DELETE FROM playlist_dependencies').run();const insert=db.prepare('INSERT OR IGNORE INTO playlist_dependencies VALUES (?,?)');for(const p of list()){expand(p.id);for(const item of JSON.parse(p.items_json))if(item.playlistId)insert.run(p.id,item.playlistId);}}
 function dependents(ids){const seen=new Set(ids),queue=[...ids];for(let i=0;i<queue.length;i++)for(const p of list())if(JSON.parse(p.items_json).some(item=>item.playlistId===queue[i])&&!seen.has(p.id)){seen.add(p.id);queue.push(p.id);}return [...seen];}
 function touch(ids,includeSelf=true){const original=new Set(ids);for(const id of dependents(ids))if(includeSelf||!original.has(id))db.prepare('UPDATE playlists SET revision=revision+1,updated_at=? WHERE id=?').run(clock(),id);}
 function touchContent(id){touch(list().filter(p=>JSON.parse(p.items_json).some(item=>item.mediaId===id)).map(p=>p.id));}
 return {expand,syncDependencies,dependents,touch,touchContent};
}
