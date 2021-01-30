/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
 
const {Storage} = require("@google-cloud/storage")
const puppeteer = require('puppeteer');
const csv = require('csv-parser')
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs')
const os = require('os');

exports.stadiaScrape = async (req, res) => {
    const filePath = "out.csv";

    const run = async () => {
        const newData = await new Promise(async (resolve, reject) => {
            try {
                const url = 'https://stadiadb.app/';

                const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
                const page = await browser.newPage();

                console.log("opening", url);

                await page.goto(url);

                await page.select('body > main > form > select', "uk");
                console.log("selecting location");
                const gameObjArr = [];
                let counter = 0;
                let notLastPage = true;

                while (notLastPage && counter < 1) {
                    counter++;
                    console.log("writing page",counter,"to array")
                    const pageArr = await page.evaluate(async () => {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        const gamesArr = Array.from(document.querySelectorAll('div:nth-child(10) table tr td')).map(td => td.innerText)
                        const pageGamesObjArr = [];
                        for (let i = 0; i < gamesArr.length; i++) {
                            const colNum = i % 4;
                            const cellContents = gamesArr[i];
                            if (colNum === 0) {
                                // push an empty array if first of the row
                                pageGamesObjArr.push({});
                            }
                            const rowObj = pageGamesObjArr[pageGamesObjArr.length - 1];
                            switch (colNum) {
                                case 0:
                                    rowObj.game = cellContents.slice(0, cellContents.search("\n"));
                                    break;
                                case 1:
                                    rowObj.currPrice = cellContents;
                                    break;
                                case 2:
                                    rowObj.lowestPrice = cellContents;
                                    break;
                            }

                        }
                        return pageGamesObjArr.filter(x => x.game != "< Prev Pag");
                    });

                    if (containsGameObject(pageArr[0], gameObjArr)) {
                        notLastPage = false;
                        break;
                    }

                    gameObjArr.push(...pageArr);
                    await page.click('body > main > div:nth-child(10) > table > tbody > tr.load-more > td:nth-child(2)');
                }
                console.log("end");
                await browser.close();
                return resolve(gameObjArr);
            } catch (e) {
                return reject(e);
            }
        })

        const oldData = await readCSVContent("out.csv");

        compareOldAndNew(oldData, newData);

        return [newData.filter(x => x.currPrice), oldData.filter(x => x.currPrice)];
    }

    await run()
        .then(async (content) => {
            await writeCSVContent("out.csv", content[0]);
        })
        .catch(err => {
            console.error(err);
        })

}



function containsGameObject(obj, list) {
    for (let i = 0; i < list.length; i++) {
        if (list[i].game === obj.game && list[i].currPrice === obj.currPrice && list[i].lowestPrice === obj.lowestPrice) {
            return true;
        }
    }
    
    return false;
}

const compareOldAndNew = (oldData, newData) => {
    console.log("comparing");
    for (let newGameObj of newData) {
        if (newGameObj.game === "game") continue;
        const oldGameObj = oldData.find(x => x.game === newGameObj.game);
        if (!oldGameObj) return false;
        const [oldPrice, newPrice] = [oldGameObj.currPrice, newGameObj.currPrice].map(x => parseFloat(x.replace("£", "")));

        if (newPrice !== oldPrice) {
            console.log(`${oldGameObj.game} has changed in price from ${oldGameObj.currPrice} to ${newGameObj.currPrice} (lowest Ever ${oldGameObj.lowestPrice})`);
            // todo send email
        }
    }
}

function readCSVContent(file) {
  return new Promise((resolve, reject) => {
    const storage = new Storage();
    let fileContents = new Buffer('');
    storage.bucket("stadia-csvs").file(file).createReadStream()
    .on('error', function(err) {
      reject('The Storage API returned an error: ' + err);
    })
    .on('data', function(chunk) {
      fileContents = Buffer.concat([fileContents, chunk]);
    })  
    .on('end', function() {
        let content = fileContents.toString('utf8');
        const objArr = content.split('\n').map(row => row.split(','))
            .map(row => {
                const [game, currPrice, lowestPrice] = row;
                return {game, currPrice, lowestPrice};
            })
      resolve(objArr);
    });
  });
}

const writeCSVContent = async (file, data) => {
    const storage = new Storage();
    const tgtFile = storage.bucket('stadia-csvs').file(file);
    const writeStream = tgtFile.createWriteStream();
    const headers = 'game,currPrice,lowestPrice\n';
    writeStream.write(headers);
    data.forEach(x => writeStream.write(`${x.game},${x.currPrice},${x.lowestPrice}\n`));
    writeStream.end();
}