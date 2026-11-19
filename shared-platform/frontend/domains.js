// The five AYUSH systems, collected from each service's frontend/index.js. Used by the service picker and the doctor's system selector.
import ayurveda from '@ayurveda/index';
import yoga from '@yoga/index';
import unani from '@unani/index';
import siddha from '@siddha/index';
import homoeopathy from '@homoeopathy/index';

export const DOMAIN_LIST = [ayurveda, yoga, unani, siddha, homoeopathy];
export const DOMAINS = Object.fromEntries(DOMAIN_LIST.map((d) => [d.key, d.label]));
