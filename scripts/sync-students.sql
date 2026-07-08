-- ============================================================
-- SVM Student Roster Sync  (run in Supabase SQL Editor)
-- 1. Remove Laxmi Saini (student_id 125) — not in master roster
-- 2. Add 40 missing students (IDs 126–165)
-- ============================================================

-- Step 1 ─ Remove Laxmi Saini
DELETE FROM student_emails WHERE student_id = 125;
-- (no student_scores rows to delete since she had no scores logged)

-- Step 2 ─ Insert missing students
INSERT INTO student_emails (student_id, student_name, class, email) VALUES
-- Class 10
(126, 'Aakhya Verma',       10, 'aakhyaverma472@gmail.com'),
(127, 'Aarav Dutta',        10, 'aaravdutta295@gmail.com'),
(128, 'Adhiraj Aggarwal',   10, 'karnika2121@gmail.com'),
(129, 'Akshita Garg',       10, 'kanikaraman09@gmail.com'),
(130, 'Arshia Singh',       10, 'arshiasingh0369@gmail.com'),
(131, 'Daksh Devgan',       10, 'ddpdskywalker007@gmail.com'),
(132, 'Gyanda Sinha',       10, 'poonambhatia001@gmail.com'),
(133, 'Harseerat Sandhu',   10, 'amandeepharseerat@gmail.com'),
(134, 'Hridaan Verma',      10, 'hridaan11@gmail.com'),
(135, 'Madhav Manan',       10, 'mm2410.gur@kunskapsskolan.edu.in'),
(136, 'Navika Kohli',       10, 'neetukohli152@gmail.com'),
(137, 'Pranav Verma',       10, 'mamtachintu015@gmail.com'),
(138, 'Raghav Aggarwal',    10, 'raghavaggarwalgaming@gmail.com'),
(139, 'Reet Gupta',         10, 'neha.trg2703@gmail.com'),
(140, 'Reyhaan Sehmi',      10, 'reyhaan.sehmi@gmail.com'),
(141, 'Saarthak Monga',     10, 'saarthakm108@gmail.com'),
(142, 'Samarth Aggarwal',   10, 'samarthaggarwal2911@gmail.com'),
(143, 'Samrat Kaushisk',    10, 'poonamkaushish1008@gmail.com'),
(144, 'Smarth Yadav',       10, 'nehanehayadav04@gmail.com'),
(145, 'Vanshika Bhatnagar', 10, 'bhatnagarvanshika13@gmail.com'),
(146, 'Yuvraj Singh',       10, 'yuvibatth28@gmail.com'),
-- Class 9
(147, 'Aanya Aggarwal',     9,  'aanyaaggarwal32@gmail.com'),
(148, 'Aaradhya',           9,  'heenaparmar.231992@gmail.com'),
(149, 'Adaa Kataria',       9,  'adaakataria01@gmail.com'),
(150, 'Ameya Goel',         9,  'goelameya550@gmail.com'),
(151, 'Arnav Mehndiratta',  9,  'arnavmehndiratta3001@gmail.com'),
(152, 'Ayaan Singh',        9,  'mrsharpreet1985@gmail.com'),
(153, 'Chahat Sehgal',      9,  'chahatehgal2012@gmail.com'),
(154, 'Fateh Partap Singh', 9,  'fatehpartap3@gmail.com'),
(155, 'Kanishk Singh',      9,  'singh14kanishk14@gmail.com'),
(156, 'Pavika Dhiman',      9,  'pavikadhiman7722@gmail.com'),
(157, 'Rudra Sharma',       9,  'rudra.k.s78891@gmail.com'),
(158, 'Rushita Gulati',     9,  'rushita1801@gmail.com'),
(159, 'Shivansh Goel',      9,  'ambala.shivansh@gmail.com'),
(160, 'Shreya Jain',        9,  'shreyaisalso@gmail.com'),
(161, 'Tanmay Gupta',       9,  'guptatanmay1710@gmail.com'),
(162, 'Trisha Soni',        9,  'tashvisoni30@gmail.com'),
(163, 'Vedansh Bajaj',      9,  'vedanshbajaj3@gmail.com'),
(164, 'Vinayak Bakshi',     9,  'sbakshi583@gmail.com'),
(165, 'Vridhi',             9,  'berivridhi@gmail.com');

-- Verify
SELECT class, COUNT(*) AS total FROM student_emails GROUP BY class ORDER BY class;
