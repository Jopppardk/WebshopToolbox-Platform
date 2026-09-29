-- Feed folders are now named after the webshop's name in WebshopToolbox instead of its domain.
-- Folders were introduced the same day; they are reserved again from the name the next time the
-- feed page is opened or a feed is saved. Feeds, file names and token links are unchanged.
DELETE FROM feed_folders;
