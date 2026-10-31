import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
export function database(path=':memory:') {
  if(path!==':memory:') mkdirSync('.local',{recursive:true});
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
  const directory = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()) {
    if (db.prepare('SELECT 1 FROM local_migrations WHERE name=?').get(name)) continue;
    // Older local previews already applied the initial schema without a journal.
    if (name==='0001_initial.sql' && db.prepare("SELECT 1 FROM sqlite_master WHERE name='records'").get()) {
      db.prepare('INSERT INTO local_migrations(name) VALUES(?)').run(name); continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(new URL(name,directory),'utf8'));
      db.prepare('INSERT INTO local_migrations(name) VALUES(?)').run(name);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
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
