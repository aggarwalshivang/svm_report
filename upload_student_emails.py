import requests

SUPABASE_URL = "https://cexbpkbadthoqbruyjdg.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleGJwa2JhZHRob3FicnV5amRnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODIzMDkyMywiZXhwIjoyMDkzODA2OTIzfQ.4bN1__qlO6NuEyhBM-yDydHcYnQ2Lc-Whj9dPLqHOrI"

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal,resolution=ignore-duplicates",
}

# Class 9 email → student_name (using exact names from Excel RawData)
CLASS_9_EMAILS = [
    ("kaurseerat4367@gmail.com",      "Jaskeerat Kaur"),
    ("gupta.kartik1011@gmail.com",    "Kartik Gupta"),
    ("sha31582@gmail.com",            "Ridhi Goyal"),
    ("chauhanbhuvi60@gmail.com",      "Bhuvi Chauhan"),
    ("arnav.saxena77@gmail.com",      "Arnav Saxena"),
    ("svmambala@gmail.com",           "Atharv Aggarwal"),
    ("manya.pv@gmail.com",            "Jivanshi"),
    ("sjnj2026@gmail.com",            "Saanvi Jain"),
    ("sharmasaanvi076@gmail.com",     "Saanvi Sharma"),
    ("tarunsia@gmail.com",            "Sarthak Sharma"),
    ("imkavish15@gmail.com",          "Kavish Batra"),
    ("guptamanishinv@gmail.com",      "Devishi Gupta"),
    ("bhavikkatoch2011@gmail.com",    "Bhavik Katoch"),
    ("prashamjain0706@gmail.com",     "Prasham Jain."),
    ("p32055808@gmail.com",           "Pavani"),
    ("dhall.adhirajmts@gmail.com",    "Adhiraj Dhall"),
    ("keshavg13112@gmail.com",        "Keshav Gupta"),
    ("devishee72@gmail.com",          "Devishee Nayar"),
    ("ayaangugs@gmail.com",           "Ayaan Guglani"),
    ("agamyasaini23@gmail.com",       "Agamya Saini"),
    ("krishchawla24@gmail.com",       "Bhavya Chawla"),
    ("aashigupta282012@gmail.com",    "Aashi Gupta"),
    ("bhatiajapnidh@gmail.com",       "Japnidh Singh"),
    ("mankiratsingh1568@gmail.com",   "Mankirat Singh"),
    ("mukul1312aggarwal@gmail.com",   "Mukul Aggarwal"),
    ("dakshjulka05@gmail.com",        "Daksh Julka"),
    ("bansalaarav395@gmail.com",      "Aarav Bansal"),
    ("meharkaur08082012@gmail.com",   "Mehar"),
    ("aabhavaggarwal@gmail.com",      "Aabhav Aggarwal"),
    ("swtkhushi66@gmail.com",         "Akshat Singh"),
    ("krishkaggarwal27@gmail.com",    "Krish Aggarwal"),
    ("gunjankushal950@gmail.com",     "Radhika Namdev"),
    ("sumedhavashishat@gmail.com",    "Vedant Vashishat"),
    ("aliyaguglani2012@gmail.com",    "Aliya Guglani"),      # not in mainsheet — stored as-is
    ("nitikachhabra1984@gmail.com",   "Avni Chhabra"),
    ("umraoramsajivan@gmail.com",     "Chhavi Saini"),
    ("aashraymaken2011@gmail.com",    "Aashray Maken"),
    ("mahirwalia775@gmail.com",       "Mahir Walia"),
    ("arnavgoel512@gmail.com",        "Arnav Goel"),
    ("jigarniteshvasoya@gmail.com",   "Jigar"),
    ("viratanand2504@gmail.com",      "Virat Anand"),        # not in mainsheet — stored as-is
    ("laxmisaini151519@gmail.com",    "Laxmi Saini"),        # not in mainsheet — stored as-is
    ("meetraghav3016@gmail.com",      "Raghav Chadha"),
    ("pinkykk03101@gmail.com",        "Ayush Kumar"),
    ("ridhaanmittalsmart@gmail.com",  "Ridhaan Mittal"),
    ("meghaaggarwalarora30@gmail.com","Anay Arora"),
    ("ridhigupta3012@gmail.com",      "Ridhi Gupta"),
]

# Class 10 emails — matched to exact Excel names
CLASS_10_EMAILS = [
    ("kanhac27gwk@gmail.com",              "Kanhav Kochhar"),
    ("ssamar2959@gmail.com",               "Samar Rana"),
    ("diyadang24@gmail.com",               "Diya Dang"),
    ("bhardwajsidak1426@gmail.com",        "Sidak Bhardwaj"),
    ("yashitasehgal10@gmail.com",          "Yashita Sehgal"),
    ("mafiajasn@gmail.com",                "Jasnoor Singh"),
    ("kaarna061@gmail.com",                "Aarna Khurana"),
    ("saanviahuja2010@gmail.com",          "Saanvi Ahuja"),
    ("anonymoushoon0@gmail.com",           "Nishchay Jain"),
    ("kanchanmeritoriousschool@gmail.com", "Hrishita"),
    ("aggarwalsaara294@gmail.com",         "Saara Aggarwal"),
    ("jain.ankur82@gmail.com",             "Arhat Jain"),
    ("urmilgogia697@gmail.com",            "Namya Gogia"),
    ("anjalidakshgupta@gmail.com",         "Daksh Gupta"),
    ("shagun30sharma@gmail.com",           "Shine Sharma"),
    ("aroraamyraa@gmail.com",              "Amyra Arora"),
    ("manpreetgill262010@gmail.com",       "Karanveer Singh Gill"),
    ("dimpleasija51@gmail.com",            "Aaryaveer"),
    ("rajnichopra772@gmail.com",           "Divyanshi Chopra"),
    ("mightycalgamer@gmail.com",           "Aahaan Verma"),
    ("rimjhim250311@gmail.com",            "Rimjhim Khurana"),
    ("shilpiaggarwal604@gmail.com",        "Advik Kansal"),
    ("shahkhushi4591@gmail.com",           "Khushi"),
    ("jaitly.priyanka@gmail.com",          "Meher Judge"),
    ("kochharsiddharth9@gmail.com",        "Siddharth Kochhar"),
    ("pratham5678sharma@gmail.com",        "Pratham Sharma"),
    ("bhavyatalwar2208@gmail.com",         "Bhavya Talwar"),
    ("nityaasha2303@gmail.com",            "Nitya S Verma"),
    ("payalsahi2010@gmail.com",            "Aarush Sahi"),
    ("vidushi.agg2011@gmail.com",          "Vidushi Aggarwal"),
    ("gargarjun902@gmail.com",             "Advika Garg"),
    ("yuvanshjain2602@gmail.com",          "Yuvansh Jain"),
    ("tanyakakkar7829@gmail.com",          "Tanya Kakkar"),
    ("dr.aaditjain@gmail.com",             "Aadit Jain"),
    ("mamta7404849060@gmail.com",          "Teesta"),
    ("aarishagg20@gmail.com",              "Aarish Aggarwal"),
    ("ilikeprosperity301985@gmail.com",    "Tarun Pal"),
    ("sharmashaurya.4444@gmail.com",       "Shaurya Sharma"),
    ("sudhantuli11@gmail.com",             "Sudhan Tuli"),
]


def build_records(email_list, class_num):
    return [
        {"student_name": name, "email": email, "class": class_num}
        for email, name in email_list
    ]


def table_exists():
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/student_emails?limit=0",
        headers=HEADERS,
    )
    return resp.status_code == 200


def upload(records):
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/student_emails",
        headers=HEADERS,
        json=records,
    )
    return resp


def main():
    print("Checking table...")
    if not table_exists():
        print()
        print("ERROR: Table 'student_emails' does not exist yet.")
        print()
        print("Run this SQL in Supabase SQL Editor first:")
        print("  https://supabase.com/dashboard/project/cexbpkbadthoqbruyjdg/sql/new")
        print()
        print("""
CREATE TABLE IF NOT EXISTS student_emails (
    id           BIGSERIAL PRIMARY KEY,
    student_name TEXT NOT NULL,
    email        TEXT NOT NULL,
    class        INTEGER,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(student_name, email)
);
CREATE INDEX IF NOT EXISTS idx_student_emails_name  ON student_emails(student_name);
CREATE INDEX IF NOT EXISTS idx_student_emails_email ON student_emails(email);
        """)
        return

    all_records = []

    if CLASS_9_EMAILS:
        r9 = build_records(CLASS_9_EMAILS, 9)
        all_records.extend(r9)
        print(f"Class 9: {len(r9)} records")

    if CLASS_10_EMAILS:
        r10 = build_records(CLASS_10_EMAILS, 10)
        all_records.extend(r10)
        print(f"Class 10: {len(r10)} records")

    print(f"Total: {len(all_records)} records")
    print()

    resp = upload(all_records)
    if resp.status_code in (200, 201):
        print(f"Done! {len(all_records)} email records uploaded to 'student_emails' table.")
    else:
        print(f"ERROR: {resp.status_code} - {resp.text[:400]}")


if __name__ == "__main__":
    main()
