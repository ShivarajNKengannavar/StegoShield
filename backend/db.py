import sqlite3
from flask import g

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect("securestego.db", detect_types=sqlite3.PARSE_DECLTYPES)
        g.db.row_factory = sqlite3.Row
    return g.db




#CREATE TABLE users (
  #id INTEGER PRIMARY KEY AUTOINCREMENT,
  #email TEXT UNIQUE,
  #password TEXT,
  #role TEXT
#);
