import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { saveStory, removeStory, storyUrl } from './saved-news.js';
import { readPreferences, savePreferences } from './preferences.js';

test('bookmarks are account-scoped, idempotent and independent of favorite-team updates', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE account_preferences(account TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const story = {
    title: 'A real headline',
    url: 'https://www.espn.com/nfl/story/_/id/123/test',
    publishedAt: '2026-10-17T12:00:00Z',
    summary: 'Do not persist the article preview',
  };
  await savePreferences(db, 'a', { favoriteTeam: 'MIN' });
  await Promise.all([
    saveStory(db, 'a', story),
    saveStory(db, 'a', { ...story, url: story.url + '2' }),
  ]);
  await saveStory(db, 'a', story);
  assert.equal((await readPreferences(db, 'a')).savedStories.length, 2);
  await savePreferences(db, 'a', { favoriteTeam: 'BUF' });
  const saved = await readPreferences(db, 'a');
  assert.equal(saved.savedStories.length, 2);
  assert.equal(saved.favoriteTeam, 'BUF');
  assert.equal('summary' in saved.savedStories[0], false);
  assert.equal((await readPreferences(db, 'b')).savedStories, undefined);
  await removeStory(db, 'b', story.url);
  assert.equal((await readPreferences(db, 'a')).savedStories.length, 2);
  await removeStory(db, 'a', story.url);
  assert.equal((await readPreferences(db, 'a')).savedStories.length, 1);
  db.close();
});

test('bookmark limit and external-link validation prevent unbounded or unsafe saved content', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE account_preferences(account TEXT PRIMARY KEY, data TEXT NOT NULL)');
  for (let n = 0; n < 50; n++)
    await saveStory(db, 'a', {
      title: 'Story ' + n,
      url: 'https://www.espn.com/nfl/story/' + n,
      publishedAt: '2026-10-17',
    });
  await assert.rejects(
    saveStory(db, 'a', {
      title: 'Full',
      url: 'https://www.espn.com/nfl/story/51',
      publishedAt: '2026-10-17',
    }),
    /50 stories/,
  );
  for (const url of [
    'javascript:alert(1)',
    'http://www.espn.com/a',
    'https://www.espn.com.evil.test/a',
    'https://user:secret@www.espn.com/a',
  ])
    assert.throws(() => storyUrl(url));
  db.close();
});
