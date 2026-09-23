const multer = require("multer");
const path = require("path");
const fs = require("fs");


const uploadFolder = path.resolve(
    __dirname,
    "../uploads/pdfs"
);


// Create folder automatically
fs.mkdirSync(uploadFolder, {
    recursive: true
});


const storage = multer.diskStorage({

    destination: (req, file, cb) => {
        cb(null, uploadFolder);
    },

    filename: (req, file, cb) => {
        cb(
            null,
            Date.now() + path.extname(file.originalname)
        );
    }

});


const upload = multer({
    storage: storage
});


module.exports = upload;