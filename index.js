//let request = require('request')
//var open = require("open");
//open("http://www.google.com")
import fs from 'fs'
import most from 'most'
import assign from 'fast.js/object/assign'//faster object.assign
import {from, throwError} from 'most'
import Subject from './src/subject/subject'

import path from 'path'
import request from 'request'
import url from 'url'

const exec = require('child_process').exec
const spawn = require('child_process').spawn

import {makeRequest, run, saveFile, getArgs} from './src/utils'


console.log("fetching documents of designs to render")

/////////deal with command line args etc
let params = getArgs()


const apiBaseProdUri = 'api.youmagine.com/v1'
const apiBaseTestUri = 'api-test.youmagine.com/v1'

const defaults = {
  resolution:'640x480'
  ,workdir:'./tmp'
  ,designsUri:'https://api.youmagine.com/v1/designs?auth_token=X5Ax97m1YomoFLxtYTzb'
  
  ,documentId:undefined
  ,designId:undefined
  ,fileName:undefined
  ,testMode:undefined
  ,login:undefined
  ,password:undefined
}
params = assign({},defaults,params)


let {workdir, designsUri, resolution, testMode, login, password} = params

//console.log("params",params)

designsUri = ["page","limit"].reduce(function(combo,paramName){
    combo += `&${paramName}=${params[paramName]}`
    return combo
  },designsUri)


workdir = path.resolve(workdir)
//setup working dir, if it does not exist
if (!fs.existsSync(workdir)){
    fs.mkdirSync(workdir)
}

let apiBaseUri = testMode !== undefined ? apiBaseTestUri : apiBaseProdUri
let authData   = (login !== undefined && password!==undefined) ? (`${login}:${password}@`) : ''

//start fetching data
let documents$ = undefined
if(params.documentId &&  params.designId){
  let documentsUri = `https://${authData}${apiBaseUri}/designs/${params.designId}/documents/${params.documentId}?auth_token=X5Ax97m1YomoFLxtYTzb`
  documents$ = makeRequest(documentsUri)
}else{

  documents$  = makeRequest(designsUri)
    .flatMap( designs => from(designs) ) //array of designs to designs one by one "down the pipe"  
    .flatMap( design=> { // for each design, request  
      let documentsUri = `https://api.youmagine.com/v1/designs/${design.id}/documents?auth_token=X5Ax97m1YomoFLxtYTzb`
      return makeRequest(documentsUri)
    })
    .flatMap( documents => from(documents) )//array of documents to documents one by one "down the pipe" 
}

//filter documents to find those that are renderable
const renderableDocuments$ =  documents$
  .filter(doc=>doc.file_contains_3d_model === true)
  .map(doc=>{
    return {url:doc.file.url,id:doc.id}
  })
  .tap(e=>console.log("documents",e))
  

//do the rendering etc
renderableDocuments$
  .map(function(doc){
      
    function render(data){
      let {fileName,outputPath} = data
      const cmd = `node ./node_modules/jam/dist/jam-headless.js ${outputPath} ${resolution}` 

      return run(cmd)
        .flatMapError(e=>throwError("error in  renderer",e))
        .flatMap(postProcess.bind(null,outputPath))        
    }

    function postProcess(outputPath){
      let ppCmd = `convert ${outputPath}.png -colorspace gray -level-colors "black,#FF0000" -define modulate:colorspace=HSB -modulate 100,200,108 ${outputPath}.png` 
      let ppCropCmd = `convert ${outputPath}.png -crop +0+1 ${outputPath}.png`

      return run(ppCmd)
        .flatMap(e=>run(ppCropCmd))
    }

    return saveFile(workdir, doc.url, params.fileName)
      .flatMap(render)
      .forEach(e=>e)
      .then(e=>console.log("done"))
       
  })
  .forEach(e=>e)
  

