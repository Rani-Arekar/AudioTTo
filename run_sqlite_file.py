import argparse
import sqlite3
from pathlib import Path


def iter_sql_statements(sql_text: str):
    """Very small SQL splitter suitable for simple .sql files.

    - Removes full-line comments starting with `--`.
    - Splits statements on `;`.

    Not intended for complex SQL containing semicolons inside strings.
    """

    cleaned_lines: list[str] = []
    for line in sql_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        cleaned_lines.append(line)

    cleaned = "\n".join(cleaned_lines)
    for stmt in cleaned.split(";"):
        statement = stmt.strip()
        if statement:
            yield statement


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a .sql file against a SQLite database and print results.")
    parser.add_argument("sql_file", help="Path to the .sql file")
    parser.add_argument("--db", default="audiotto.db", help="Path to the SQLite .db file (default: audiotto.db)")
    args = parser.parse_args()

    db_path = Path(args.db)
    sql_path = Path(args.sql_file)

    if not db_path.exists():
        raise SystemExit(f"DB not found: {db_path.resolve()}")
    if not sql_path.exists():
        raise SystemExit(f"SQL file not found: {sql_path.resolve()}")

    sql_text = sql_path.read_text(encoding="utf-8")

    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    try:
        for statement in iter_sql_statements(sql_text):
            print("\nSQL>", statement)

            cur.execute(statement)
            lowered = statement.lstrip().lower()

            if lowered.startswith("select") or lowered.startswith("pragma"):
                rows = cur.fetchall()
                if not rows:
                    print("(no rows)")
                else:
                    for row in rows:
                        print(dict(row))
            else:
                con.commit()
                print(f"(ok, {cur.rowcount} rows affected)")
    finally:
        con.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
