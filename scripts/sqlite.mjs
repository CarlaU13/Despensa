import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
export function database(path=':memory:') {
  if(path!==':memory:') mkdirSync('.local',{recursive:true});
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON');
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='records'").get()) db.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  function prepare(sql) {
    let bindings=[];
    const api={
      bind(...args){bindings=args;return api;},
      async first(){return db.prepare(sql).get(...bindings)||null;},
      async all(){return {results:db.prepare(sql).all(...bindings)};},
      async run(){const result=db.prepare(sql).run(...bindings);return {meta:{changes:Number(result.changes)}};},
      _execute(){const stmt=db.prepare(sql);const results=stmt.columns().length?stmt.all(...bindings):[];if(!stmt.columns().length)stmt.run(...bindings);return {results};}
    }; return api;
  }
  return {
    prepare,
    async batch(statements){db.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s._execute());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}},
    close(){db.close();}, _raw:db
  };
}
