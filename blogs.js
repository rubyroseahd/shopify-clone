import { logger } from '../logger.js';

export const name = 'Blogs & Articles';
export const key = 'blogs';

/**
 * Clone blogs and their articles from source to target store.
 */
export async function clone(sourceApi, targetApi, options) {
  const blogs = await sourceApi.getAll('/blogs.json', 'blogs');
  logger.info(`Found ${blogs.length} blogs in source store`);

  if (options.dryRun) {
    // Count articles across all blogs
    let articleCount = 0;
    for (const blog of blogs) {
      const articles = await sourceApi.getAll(
        `/blogs/${blog.id}/articles.json`,
        'articles'
      );
      articleCount += articles.length;
    }
    logger.info(`Found ${articleCount} total articles across all blogs`);
    return { count: blogs.length };
  }

  let clonedBlogs = 0;
  let clonedArticles = 0;

  for (const blog of blogs) {
    try {
      // Create the blog on target
      const blogPayload = {
        title: blog.title,
        handle: blog.handle,
        commentable: blog.commentable,
        template_suffix: blog.template_suffix,
      };

      const created = await targetApi.post('/blogs.json', { blog: blogPayload });
      const targetBlogId = created.blog.id;
      logger.verbose(`Created blog "${blog.title}"`);
      clonedBlogs++;

      // Fetch and clone all articles for this blog
      const articles = await sourceApi.getAll(
        `/blogs/${blog.id}/articles.json`,
        'articles'
      );
      logger.verbose(`Blog "${blog.title}" has ${articles.length} articles`);

      for (const article of articles) {
        try {
          const articlePayload = {
            title: article.title,
            author: article.author,
            body_html: article.body_html,
            handle: article.handle,
            tags: article.tags,
            summary_html: article.summary_html,
            template_suffix: article.template_suffix,
            published: article.published_at ? true : false,
          };

          if (article.image && article.image.src) {
            articlePayload.image = { src: article.image.src, alt: article.image.alt };
          }

          await targetApi.post(`/blogs/${targetBlogId}/articles.json`, {
            article: articlePayload,
          });
          logger.verbose(`  Created article "${article.title}"`);
          clonedArticles++;
        } catch (err) {
          logger.error(`Failed to clone article "${article.title}": ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`Failed to clone blog "${blog.title}": ${err.message}`);
    }
  }

  logger.success(`Cloned ${clonedBlogs}/${blogs.length} blogs with ${clonedArticles} articles`);
  return { count: clonedBlogs };
}
