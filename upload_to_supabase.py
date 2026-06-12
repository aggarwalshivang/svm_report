import pandas as pd
import requests

SUPABASE_URL = "https://cexbpkbadthoqbruyjdg.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleGJwa2JhZHRob3FicnV5amRnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODIzMDkyMywiZXhwIjoyMDkzODA2OTIzfQ.4bN1__qlO6NuEyhBM-yDydHcYnQ2Lc-Whj9dPLqHOrI"

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

FILES = {
    9:  "c:/D/IDE PROJECTS/SVM/student_report/SVM Mainsheet Class 9th 2026-27.xlsx",
    10: "c:/D/IDE PROJECTS/SVM/student_report/SVM Mainsheet Class 10th 2026-27.xlsx",
}


def parse_file(class_num, filepath):
    df = pd.read_excel(filepath, sheet_name="RawData", header=None)

    dates    = df.iloc[1, 1:].tolist()
    subjects = df.iloc[2, 1:].tolist()
    totals   = df.iloc[3, 1:].tolist()
    topics   = df.iloc[4, 1:].tolist()

    records = []
    for row_idx in range(5, len(df)):
        student = str(df.iloc[row_idx, 0]).strip()
        if not student or student == "nan":
            continue

        for col_idx, (date, subject, total, topic) in enumerate(zip(dates, subjects, totals, topics)):
            if pd.isna(date) or pd.isna(subject):
                continue

            raw_score = df.iloc[row_idx, col_idx + 1]
            score_str = str(raw_score).strip() if not pd.isna(raw_score) else None

            try:
                date_str = pd.to_datetime(date).strftime("%Y-%m-%d")
            except Exception:
                date_str = str(date)

            try:
                total_marks = int(float(str(total))) if not pd.isna(total) else None
            except Exception:
                total_marks = None

            if score_str is None or score_str.lower() == "nan":
                score_obtained = None
                is_absent = False
            elif score_str.lower() == "absent":
                score_obtained = None
                is_absent = True
            else:
                try:
                    score_obtained = float(score_str)
                    is_absent = False
                except ValueError:
                    score_obtained = None
                    is_absent = False

            records.append({
                "class": class_num,
                "student_name": student,
                "date": date_str,
                "subject": str(subject).strip(),
                "topic_name": str(topic).strip() if not pd.isna(topic) else None,
                "total_marks": total_marks,
                "score_obtained": score_obtained,
                "is_absent": is_absent,
            })

    return records


def table_exists():
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/student_scores?limit=0",
        headers=HEADERS,
    )
    return resp.status_code == 200


def upload_records(records, batch_size=500):
    url = f"{SUPABASE_URL}/rest/v1/student_scores"
    total = len(records)
    uploaded = 0

    for i in range(0, total, batch_size):
        batch = records[i:i + batch_size]
        resp = requests.post(url, headers=HEADERS, json=batch)
        if resp.status_code in (200, 201):
            uploaded += len(batch)
            print(f"  Uploaded {uploaded}/{total} records...")
        else:
            print(f"  ERROR at batch {i}: {resp.status_code} - {resp.text[:300]}")
            return False
    return True


def main():
    print("Checking if table exists...")
    if not table_exists():
        print()
        print("ERROR: Table 'student_scores' does not exist yet.")
        print()
        print("Please do the following:")
        print("  1. Open https://supabase.com/dashboard/project/cexbpkbadthoqbruyjdg/sql")
        print("  2. Click 'New Query'")
        print("  3. Open and copy the contents of 'create_table.sql'")
        print("  4. Paste into the editor and click 'Run'")
        print("  5. Then re-run this script")
        return

    print("Table found.")
    print()
    print("Parsing Excel files...")
    all_records = []
    for class_num, filepath in FILES.items():
        records = parse_file(class_num, filepath)
        print(f"  Class {class_num}: {len(records)} records")
        all_records.extend(records)

    print(f"Total: {len(all_records)} records")
    print()
    print("Uploading to Supabase...")
    success = upload_records(all_records)

    if success:
        print()
        print(f"Done! {len(all_records)} records uploaded to 'student_scores' table.")
    else:
        print()
        print("Upload failed. Check error messages above.")


if __name__ == "__main__":
    main()
