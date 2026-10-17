import { invalid } from './errors.js';
import { updatePreferences } from './preferences.js';

export const SAVED_STORY_LIMIT = 50;
export function storyUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw invalid('Choose a valid ESPN story.');
  }
  if (
    typeof value !== 'string' ||
    value.length > 2000 ||
    url.protocol !== 'https:' ||
    !['www.espn.com', 'espn.com'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw invalid('Choose a valid ESPN story.');
  return url.href;
}

/** Store a small bookmark, not the article body or a copy of every feed response. */
export async function saveStory(db, account, article) {
  const url = storyUrl(article.url);
  if (
    typeof article.title !== 'string' ||
    !article.title.trim() ||
    article.title.length > 500 ||
    !Number.isFinite(Date.parse(article.publishedAt))
  )
    throw invalid('This story cannot be saved.');
  return updatePreferences(db, account, (data) => {
    const stories = data.savedStories || [];
    if (stories.some((story) => story.url === url)) return data;
    if (stories.length >= SAVED_STORY_LIMIT)
      throw invalid('You can save up to 50 stories. Remove one to save another.');
    return {
      ...data,
      savedStories: [
        {
          url,
          title: article.title,
          publishedAt: article.publishedAt,
          savedAt: new Date().toISOString(),
        },
        ...stories,
      ],
    };
  });
}

export async function removeStory(db, account, value) {
  const url = storyUrl(value);
  return updatePreferences(db, account, (data) => ({
    ...data,
    savedStories: (data.savedStories || []).filter((story) => story.url !== url),
  }));
}
