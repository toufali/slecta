import Router from '@koa/router';

const router = new Router();

router.get('/hello', async (ctx, next) => {
  return ctx.body = 'hello world'
});

export default router.routes()