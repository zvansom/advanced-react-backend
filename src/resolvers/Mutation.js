const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const { promisify } = require('util');
const { hasPermission } = require('../utils');
const stripe = require('../stripe');

const { makeANiceEmail, transport } = require('../mail');

const Mutations = {
  async createItem(parent, args, ctx, info) {
    // TODO: Check if logged in
    if(!ctx.request.userId) {
      throw new Error(`You must be logged in to do that!`);
    }

    const item = await ctx.db.mutation.createItem({
      data: {
        // Make the relationship between item and user
        user: {
          connect: {
            id: ctx.request.userId,
          },
        },
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
    const item = await ctx.db.query.item({ where }, `{ id title user { id } }`);
    // 2. check for permissions
    const ownsItem = item.user.id === ctx.request.userId;
    const hasPermissions = ctx.request.user.permissions.some(permission => 
      [`ADMIN`, `ITEMDELETE`].includes(permission));
    
    if(!ownsItem && !hasPermissions) {
      throw new Error(`You don't have permission to do that.`);
    }
    // 3. delete it
    return ctx.db.mutation.deleteItem({ where }, info);
  },
  async signup(parent, args, ctx, info) {
    // Format the email
    args.email = args.email.toLowerCase();
    // Hash their password
    const password = await bcrypt.hash(args.password, 10);
    // Create user in the db
    const user = await ctx.db.mutation.createUser(
      {
        data: {
          ...args,
          password,
          permissions: { set: [`USER`] },
        },
      }, 
      info
    );
    // Create the JWT
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    // Set the JWT as a cookie on the response
    ctx.response.cookie(`token`, token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year cookie
    });
    return user;
  },
  async signin(parent, { email, password }, ctx, info) {
    // Check if the user exists
    const user = await ctx.db.query.user({ where: { email } });
    if(!user) {
      throw new Error(`No user found for ${email}`);
    }
    // Check for correct password
    const valid = await bcrypt.compare(password, user.password);
    if(!valid) {
      throw new Error(`Invalid Password`);
    }
    // Generate JWT
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    // Set the cookie with token
    ctx.response.cookie(`token`, token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    // Return the user
    return user;
  },
  signout(parent, args, ctx, info) {
    ctx.response.clearCookie(`token`);
    return { message: `Goodbye!` };
  },
  async requestReset(parent, { email }, ctx, info) {
    // Check if the user exists
    const user = await ctx.db.query.user({ where: { email } });
    if(!user) {
      throw new Error(`No user found for ${email}`);
    }
    // Set a reset token and expiry on user
    const randomBytesPromisified = promisify(randomBytes);
    const resetToken = (await randomBytesPromisified(20)).toString(`hex`);
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now
    const res = await ctx.db.mutation.updateUser({
      where: { email },
      data: { resetToken, resetTokenExpiry },
    });
    // Email the reset token
    const mailRes = await transport.sendMail({
      from: `zach@mail.com`,
      to: user.email,
      subject: `Your password reset token`,
      html: makeANiceEmail(`
        Your Password Reset Token is here! 
        \n\n 
        <a href="${process.env.FRONTEND_URL}/reset?resetToken=${resetToken}">
          Cliick Here to Reset
        </a>
      `),
    })
    
    // Return success message
    return { message: `Thanks` }
  },
  async resetPassword(parent, args, ctx, info) {
    // Check that the passwords match
    if(args.password !== args.confirmPassword) {
      throw new Error(`Your Passwords do not match`);
    }
    // Check for good reset token
    // Check if reset token expired
    const [user] = await ctx.db.query.users({
      where: {
        resetToken: args.resetToken,
        resetTokenExpiry_gte: Date.now() - 3600000
      },
    });
    if(!user) {
      throw new Error(`This token is invalid or expired.`);
    }
    // Hash new password
    const password = await bcrypt.hash(args.password, 10);
    // Save the new password and remove resetToken fields
    const updatedUser = await ctx.db.mutation.updateUser({
      where: { email: user.email },
      data: {
        password,
        resetToken: null,
        resetTokenExpiry: null,
      }
    });
    // Generate JWT
    const token = jwt.sign({ userId: updatedUser.id }, process.env.APP_SECRET);
    // Set the JWT cookie
    ctx.response.cookie(`token`, token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    // Return new user
    return updatedUser;
  },
  async updatePermissions(parent, args, ctx, info) {
    // Check if user is logged in
    if(!ctx.request.userId) {
      throw new Error(`You must be logged in.`);
    }
    // Query the current user
    const currentUser = await ctx.db.query.user({
      where: {
        id: ctx.request.userId,
      },
    }, 
    info
    );
    // Check if user has permissions to make changeds
    hasPermission(currentUser, [`ADMIN`, `PERMISSIONUPDATE`]);
    // Update the permissions
    return ctx.db.mutation.updateUser({
      data: {
        permissions: {
          set: args.permissions,
        },
      },
      where: {
        id: args.userId,
      },
    }, info);
  },
  async addToCart(parent, args, ctx, info) {
    // Make sure user is signed in
    const { userId } = ctx.request;
    if(!userId) {
      throw new Error(`You must be signed in`);
    }
    // Query the users existing cart
    const [existingCartItem] = await ctx.db.query.cartItems({
      where: {
        user: { id: userId },
        item: { id: args.id },
      },
    });
    // Check if item is already in cart and increment qty
    if(existingCartItem) {
      console.log(`This item is already in your cart`);
      return ctx.db.mutation.updateCartItem({
        where: { id: existingCartItem.id },
        data: { quantity: existingCartItem.quantity + 1 },
      }, 
      info
      );
    }
    // If not create new CartItem for user
    return ctx.db.mutation.createCartItem({
      data: {
        user: {
          connect: { id: userId },
        },
        item: {
          connect: { id: args.id },
        },
      },
    }, info);
  },
  async removeFromCart(parent, args, ctx, info) {
    // Find the cart item
    const cartItem = await ctx.db.query.cartItem({
      where: {
        id: args.id,
      },
    }, `{ id, user { id }}`);
    // Make sure found an item
    if(!cartItem) {
      throw new Error(`No Cart Item Found!`);
    }
    // Make sure item is in users cart
    if(cartItem.user.id !== ctx.request.userId) {
      throw new Error(`Sorry you can't do that.`);
    }
    // Delete the cart item
    return ctx.db.mutation.deleteCartItem({
      where: {
        id: args.id
      }
    }, info);
  },
  async createOrder(parent, args, ctx, info) {
    // Query the current user. Make sure signed in.
    const { userId } = ctx.request;
    if(!userId) throw new Error('You must be signed in to complete this order');
    const user = await ctx.db.query.user({ where: { id: userId } }, `
    {
      id 
      name 
      email 
      cart { 
        id 
        quantity 
        item { 
          title 
          price 
          id 
          description 
          image
          largeImage
        }
      }
    }
  `);
    // Recalculate the total for the price
    const amount = user.cart.reduce((tally, cartItem) => tally + cartItem.item.price * cartItem.quantity, 0);
    console.log(`Going to charge for a total of ${amount}`);
    // Create the stripe charge 
    const charge = await stripe.charges.create({
      amount,
      currency: 'USD',
      source: args.token,
    });
    // Convert the CartItems to OrderItems
    const orderItems = user.cart.map(cartItem => {
      const orderItem = {
        ...cartItem.item,
        quantity: cartItem.quantity,
        user: { connect: { id: userId } },
      };
      delete orderItem.id;
      return orderItem;
    });
    // Create the Order
    const order = await ctx.db.mutation.createOrder({
      data: {
        total: charge.amount,
        charge: charge.id,
        items: { create: orderItems },
        user: { connect: { id: userId } },
      },
    });
    // Clear the user's cart, delete cartItems
    const cartItemIds = user.cart.map(cartItem => cartItem.id);
    await ctx.db.mutation.deleteManyCartItems({ 
      where: {
        id_in: cartItemIds,
      }
    });
    // Return the Order to the client
    return order;
  }
};

module.exports = Mutations;
