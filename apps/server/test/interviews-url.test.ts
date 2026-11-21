import { describe, expect, it } from 'vitest';
import { interviewCreateSchema, parseGithubRepoUrl } from '@thegrave/shared';

const ok = (owner: string, repo: string, ref: string | null = null) => ({ owner, repo, ref });

describe('parseGithubRepoUrl', () => {
  it.each([
    ['owner/repo', ok('owner', 'repo')],
    ['  owner/repo  ', ok('owner', 'repo')],
    ['https://github.com/owner/repo', ok('owner', 'repo')],
    ['https://github.com/owner/repo/', ok('owner', 'repo')],
    ['https://github.com/owner/repo.git', ok('owner', 'repo')],
    ['https://github.com/owner/repo.git/', ok('owner', 'repo')],
    ['http://github.com/owner/repo', ok('owner', 'repo')],
    ['https://www.github.com/owner/repo', ok('owner', 'repo')],
    ['github.com/owner/repo', ok('owner', 'repo')],
    ['www.github.com/owner/repo', ok('owner', 'repo')],
    ['https://github.com/owner/repo?tab=readme#top', ok('owner', 'repo')],
    ['https://github.com/owner/repo/tree/main', ok('owner', 'repo', 'main')],
    ['https://github.com/owner/repo/tree/main/', ok('owner', 'repo', 'main')],
    ['https://github.com/owner/repo/tree/feature/x-1', ok('owner', 'repo', 'feature/x-1')],
    ['https://github.com/owner/repo/tree/v1.2.3', ok('owner', 'repo', 'v1.2.3')],
    ['my-org/my.repo_x', ok('my-org', 'my.repo_x')],
    ['a/b', ok('a', 'b')],
    [`${'a'.repeat(39)}/repo`, ok('a'.repeat(39), 'repo')],
  ])('accepts %s', (input, expected) => {
    expect(parseGithubRepoUrl(input)).toEqual(expected);
  });

  it.each([
    [''],
    ['   '],
    ['owner'],
    ['owner/'],
    ['/repo'],
    ['owner/repo/extra'],
    ['https://user:pass@github.com/owner/repo'],
    ['https://user@github.com/owner/repo'],
    ['https://github.com:8080/owner/repo'],
    ['https://gist.github.com/owner/abc123'],
    ['gist.github.com/owner/abc123'],
    ['https://github.com.evil.com/owner/repo'],
    ['https://evil.com/github.com/owner/repo'],
    ['https://notgithub.com/owner/repo'],
    ['ftp://github.com/owner/repo'],
    ['javascript://github.com/owner/repo'],
    ['https://github.com/owner/repo/blob/main/a.ts'],
    ['https://github.com/owner/repo/issues'],
    ['https://github.com/owner'],
    ['https://github.com/owner/repo/tree'],
    ['https://github.com/owner/repo/tree/a..b'],
    ['https://github.com/owner/repo/tree/../x'],
    ['https://github.com/owner/repo/tree/a%2e%2e/b'],
    ['https://github.com/owner/repo/tree/' + 'a'.repeat(101)],
    ['owner/..'],
    ['owner/.'],
    ['-owner/repo'],
    [`${'a'.repeat(40)}/repo`],
    ['own_er/repo'],
    ['ówner/repo'],
    ['owner/répo'],
    ['https://github.com/owner/repo with space'],
    ['owner/repo?x=1'],
  ])('rejects %j', (input) => {
    expect(parseGithubRepoUrl(input)).toBeNull();
  });
});

describe('interviewCreateSchema', () => {
  it('defaults the level to AUTO and trims the url', () => {
    expect(interviewCreateSchema.parse({ repoUrl: ' owner/repo ' })).toEqual({
      repoUrl: 'owner/repo',
      level: 'AUTO',
    });
  });

  it('rejects a bad url, a bad level and an over-long url', () => {
    expect(interviewCreateSchema.safeParse({ repoUrl: 'nope' }).success).toBe(false);
    expect(interviewCreateSchema.safeParse({ repoUrl: 'a/b', level: 'GOD' }).success).toBe(false);
    expect(interviewCreateSchema.safeParse({ repoUrl: `a/${'b'.repeat(300)}` }).success).toBe(
      false,
    );
  });
});
