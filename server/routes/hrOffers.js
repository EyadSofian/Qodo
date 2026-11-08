import { Router } from 'express';
import { handle } from './hrFail.js';
import { offerCatalog, previewOffer, createOfferDraft, getOffer, listOffers, offerFile, sourceOfferFile, sendOffer, saveOfferEmailTemplate } from '../hr/recruitment/offers.js';

const router=Router();
const h=(fn) => handle(fn,'hr.offers');
function download(res,file) {
  res.set('Cache-Control','no-store');
  res.type(file.contentType);
  res.attachment(file.filename);
  res.send(file.bytes);
}
router.use((_req,res,next) => {res.set('Cache-Control','no-store');next();});
router.get('/catalog',h((req) => offerCatalog(req.user)));
router.put('/email-template',h((req) => saveOfferEmailTemplate(req.user,req.body)));
router.get('/sources/:id',h(async (req,res) => download(res,await sourceOfferFile(req.user,req.params.id))));
router.post('/preview',h((req) => previewOffer(req.user,req.body)));
router.get('/',h((req) => listOffers(req.user)));
router.post('/',h(async (req,res) => res.status(201).json(await createOfferDraft(req.user,req.body))));
router.get('/:id',h((req) => getOffer(req.user,req.params.id)));
router.get('/:id/files/:index',h(async (req,res) => download(res,await offerFile(req.user,req.params.id,req.params.index))));
router.post('/:id/send',h((req) => sendOffer(req.user,req.params.id)));
export default router;
