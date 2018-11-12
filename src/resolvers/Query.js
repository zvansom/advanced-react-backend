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
  },
  async order(parent, args, ctx, info) {
    // Make sure user is logged in
    if(!ctx.request.userId) {
      throw new Error(`You aren't logged in!`);
    }
    // Query the current order
    const order = await ctx.db.query.order({
      where: { id: args.id },
    }, info);
    // Check if they have permissions to see this order
    const ownsOrder = order.user.id === ctx.request.userId;
    const hasPermissionToSeeOrder = ctx.request.user.permissions.includes('ADMIN');
    if(!ownsOrder || !hasPermissionToSeeOrder) {
      throw new Error(`You don't have permission to view this.`)
    }
    // return the order
    return order;
  },
};

module.exports = Query;
