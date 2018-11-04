const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const { promisify } = require('util');

const { makeANiceEmail, transport } = require('../mail');

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
          permissions: { set: ['USER'] },
        },
      }, 
      info
    );
    // Create the JWT
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    // Set the JWT as a cookie on the response
    ctx.response.cookie('token', token, {
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
      throw new Error('Invalid Password');
    }
    // Generate JWT
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    // Set the cookie with token
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    // Return the user
    return user;
  },
  signout(parent, args, ctx, info) {
    ctx.response.clearCookie('token');
    return { message: 'Goodbye!' };
  },
  async requestReset(parent, { email }, ctx, info) {
    // Check if the user exists
    const user = await ctx.db.query.user({ where: { email } });
    if(!user) {
      throw new Error(`No user found for ${email}`);
    }
    // Set a reset token and expiry on user
    const randomBytesPromisified = promisify(randomBytes);
    const resetToken = (await randomBytesPromisified(20)).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now
    const res = await ctx.db.mutation.updateUser({
      where: { email },
      data: { resetToken, resetTokenExpiry },
    });
    // Email the reset token
    const mailRes = await transport.sendMail({
      from: 'zach@mail.com',
      to: user.email,
      subject: 'Your password reset token',
      html: makeANiceEmail(`
        Your Password Reset Token is here! 
        \n\n 
        <a href="${process.env.FRONTEND_URL}/reset?resetToken=${resetToken}">
          Cliick Here to Reset
        </a>
      `),
    })
    
    // Return success message
    return { message: 'Thanks' }
  },
  async resetPassword(parent, args, ctx, info) {
    // Check that the passwords match
    if(args.password !== args.confirmPassword) {
      throw new Error('Your Passwords do not match');
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
      throw new Error('This token is invalid or expired.');
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
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    // Return new user
    return updatedUser;
  },
};

module.exports = Mutations;
