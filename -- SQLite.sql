SELECT id, username FROM users ORDER BY id;

SELECT id, user_id, folder, pdf_filename, created_at
FROM notes
ORDER BY datetime(created_at) DESC;

SELECT n.id, u.username, n.folder, n.pdf_filename, n.created_at
FROM notes n
JOIN users u ON u.id = n.user_id
ORDER BY datetime(n.created_at) DESC;