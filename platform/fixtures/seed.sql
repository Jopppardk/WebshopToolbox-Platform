-- Synthetic data only. No login email is used as an authorization identity.
INSERT INTO companies(id,name) VALUES ('company-a','Testvirksomhed A'),('company-b','Testvirksomhed B');
INSERT INTO webshops(id,company_id,name,domain) VALUES
 ('shop-a1','company-a','Webshop A1','a1.example.test'),('shop-a2','company-a','Webshop A2','a2.example.test'),
 ('shop-b1','company-b','Webshop B1','b1.example.test');
INSERT INTO users(id,identity_issuer,identity_subject,email,company_id) VALUES
 ('local-admin','urn:webshop-toolbox:local-test','local-admin','admin@example.test',NULL),
 ('local-a','urn:webshop-toolbox:local-test','local-a','a@example.test','company-a'),
 ('local-b','urn:webshop-toolbox:local-test','local-b','b@example.test','company-b'),
 ('local-reader','urn:webshop-toolbox:local-test','local-reader','reader@example.test','company-a');
INSERT INTO platform_admins VALUES ('local-admin');
INSERT INTO company_memberships VALUES ('company-a','local-a','admin'),('company-b','local-b','admin'),('company-a','local-reader','member');
INSERT INTO webshop_memberships VALUES ('company-a','shop-a1','local-reader','reader');
INSERT INTO source_records VALUES
 ('record-a','company-a','shop-a1','fixture','123','order'),('record-b','company-b','shop-b1','fixture','123','order');

UPDATE users SET full_name='Testbruger';
