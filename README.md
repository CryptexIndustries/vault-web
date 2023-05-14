# Setting up a development environment

## Required steps

-   Install NodeJS 16 `nodejs-lts-gallium`
-   Install NPM `npm`
-   Install project dependencies
    -   `npm install`
-   Clone the file `.env.default` and rename it to `.env`
    -   Change the required variables as you see fit
-   Create the database
    -   `npx prisma migrate dev`

## Optional utilities

-   Stripe
    -   Install `stripe-cli`
        -   Windows: follow the docs
        -   Linux: `yay -Syy stripe-cli`
    -   To run the CLI: `stripe listen --forward-to localhost:3000/api/stripe_webhook`

# Running in a dev environment

-   Start the application
    -   `npm run dev`

## Useful commands

-   Run the Typescript compiler in watch mode
    -   `npm run tsc-lint`
-   Lint the current project with Next.js
    -   `npm run lint`

# Database

## Some useful commands

-   Database viewer
    -   `npx prisma studio`
-   Make migrations
    -   `npx prisma migrate dev --name init`
-   Push changes
    -   `npx prisma db push`
-   Generate the type definitions
    -   `npx prisma generate`
-   Reset your database and apply all migrations
    -   `npx prisma migrate reset`
-   Format the prisma schema file
    -   `npx prisma format`

## Modifying the schema

-   Create the migration file
-   In order to make sure that the type files get generated on your machine, remove the `node_modules` directory
-   Then run `npm install`

# Bundle analysis

## Preparations

-   Rename the file `next.config.mjs` to `next-config.js`
-   Follow the instructions inside that file in order to prepare the file for bundle analysis

## Command

-   This command will generate the bundle analysis files and automatically open the web browser
    -   `ANALYSIS=true npm run build`
