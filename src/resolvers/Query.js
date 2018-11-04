const { forwardTo } = require('prisma-binding');
const { hasPermission } = require('../utils');

const Query = {
  items: forwardTo('db'),
  item: forwardTo('db'),
  itemsConnection: forwardTo('db'),
  me(parent, args, ctx, info) {
    // check if there is a current user ID
    if(!ctx.request.userId) {
      return null;
    }
    return ctx.db.query.user(
      {
        where: { id: ctx.request.userId },
      }, 
      info
    );
  },
  async users(parent, args, ctx, info) {
    // Check if logged in
    if(!ctx.request.userId) {
      throw new Error('You must be logged in.');
    }
    // Check if user has permission to see users
    hasPermission(ctx.request.user, ['ADMIN', 'PERMISSIONUPDATE']);
    // Query the users
    return ctx.db.query.users({}, info);
  }
};

module.exports = Query;
