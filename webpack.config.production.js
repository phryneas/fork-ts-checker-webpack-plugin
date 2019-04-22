const path = require('path');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

const main = [
    './src/index.ts'
];

module.exports = {
    context: process.cwd(), // to automatically find tsconfig.json
    entry: {
        main: main
    },
    output: {
        path: path.join(process.cwd(), 'dist'),
        filename: '[name].js',
    },
    plugins: [
        new ForkTsCheckerWebpackPlugin({
            async: false,
            useTypescriptIncrementalApi: true,
            memoryLimit: 4096
        }),
    ],
    module: {
        rules: [
            {
                test: /.tsx?$/,
                use: [
                    { loader: 'ts-loader', options: { transpileOnly: true } }
                ],
            }
        ]
    },
    resolve: {
        extensions: [".tsx", ".ts", ".js"]
    }
};
