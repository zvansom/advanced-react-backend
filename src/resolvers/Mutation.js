const Mutations = {
  async createItem(parent, args, ctx, info) {
    // TODO: Check if logged in

    const item = await ctx.db.mutation.createItem({
      data: {
        ...args,
      },
    }, info);

    return item;
  },
  updateItem(parent, args, ctx, info) {
    // Get a copy of the updates
    const updates = { ...args };
    // Remove the ID from update
    delete updates.id;
    // Run the update method
    return ctx.db.mutation.updateItem(
      {
        data: updates,
        where: {
          id: args.id,
        },
      }, 
      info
    );
  },
  async deleteItem(parent, args, ctx, info) {
    const where = { id: args.id };
    // 1. find the item
    const item = await ctx.db.query.item({ where }, `{ id title }`);
    // 2. check for permissions
    // 3. delete it
    return ctx.db.mutation.deleteItem({ where }, info);
  }
};

module.exports = Mutations;
